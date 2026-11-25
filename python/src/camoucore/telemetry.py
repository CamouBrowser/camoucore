"""
Proxy telemetry: how often anti-bot providers let a launch through, challenge it
or block it, counted per provider and reported with the proxy provider's domain.

What is collected, and nothing else:
  - per anti-bot provider (Cloudflare, DataDome, hCaptcha, ...): how many
    encounters ended in success, challenge, block, or an outcome the browser
    cannot see (unknown);
  - the launch's dimensions: launcher, launcher version, browser version, Pro or
    not, a spoofed OS other than the host's (cross-OS) or not, passthrough or
    not, and the proxy provider's registrable domain ("none" without a proxy).
Never collected: a URL, a site, a page's content, a cookie, a header value, an
IP address, a proxy's username, password, host or port, or any identifier of
the user or the machine. Reports carry no ID and no timestamp of their own.

How it listens: each response is matched against antibot-rules.json, which
names only the providers' own endpoints and the headers their edges add. A
response from anywhere else is dropped after that match. A body is read only
from a provider endpoint, or from an error page a provider's edge served, and
only to test the rule's pattern; it is never kept.

An encounter is one page meeting one provider on one site. Its outcome is the
worst it reached: a block, else a challenge that did not clear by itself, else
success. The site is held in memory only to tell encounters apart and is
dropped when the encounter is counted.

Off with `telemetry=False` (the launcher's defaults file or the launch call),
`<NAME>_TELEMETRY=0`, or `DO_NOT_TRACK=1`.
"""

import atexit
import inspect
import ipaddress
import json
import os
import re
import threading
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Tuple, Union
from urllib.parse import parse_qs, urlsplit

from .product import Product

DEFAULT_ENDPOINT = 'https://api.camoufox.com/v1/telemetry/antibot'
SCHEMA = 1
OUTCOMES = ('success', 'challenge', 'block', 'unknown')
FLUSH_INTERVAL = 600.0
SEND_TIMEOUT = 3.0
BODY_LIMIT = 65536
_OFF = {'0', 'false', 'off', 'no'}

with open(Path(__file__).parent / 'antibot-rules.json', encoding='utf-8') as _f:
    RULES_DATA: Dict[str, Any] = json.load(_f)


def telemetry_enabled(product: Product, setting: Optional[bool]) -> bool:
    """Whether to report: the launch's setting, unless the environment turns it off."""
    if setting is False:
        return False
    if (product.getenv('TELEMETRY') or '').strip().lower() in _OFF:
        return False
    dnt = os.environ.get('DO_NOT_TRACK', '').strip().lower()
    return not (dnt and dnt not in _OFF)


# ---------------------------------------------------------------- domains

_SUFFIXES = frozenset(RULES_DATA['multi_label_suffixes'])


def registrable_domain(host: str) -> str:
    """The domain a business registers: 'gate.example.co.uk' -> 'example.co.uk'."""
    labels = host.lower().rstrip('.').split('.')
    keep = 3 if '.'.join(labels[-2:]) in _SUFFIXES else 2
    return '.'.join(labels[-keep:])


# Loopback, private, link-local, carrier-grade NAT (tailnets) and unique-local.
_SELF_HOSTED = [
    ipaddress.ip_network(n)
    for n in (
        '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10',
        '::1/128', 'fc00::/7', 'fe80::/10',
    )
]


def _proxy_host(proxy: Union[None, str, Mapping[str, Any]]) -> Optional[str]:
    server = proxy.get('server') if isinstance(proxy, Mapping) else proxy
    if not server:
        return None
    server = str(server).strip()
    if '://' not in server:
        server = 'http://' + server
    try:
        return urlsplit(server).hostname
    except ValueError:
        return None


def proxy_provider(proxy: Union[None, str, Mapping[str, Any]]) -> str:
    """
    The proxy provider's registrable domain, and nothing else of the proxy:
    'none' without one, 'ip-address' for a bare IP, 'self-hosted' for a
    loopback, private or tailnet host.
    """
    host = _proxy_host(proxy)
    if not host:
        return 'none'
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if any(address in network for network in _SELF_HOSTED if network.version == address.version):
            return 'self-hosted'
        return 'ip-address'
    if '.' not in host or host.endswith(('.local', '.internal', '.lan', '.ts.net', '.localhost')):
        return 'self-hosted'
    return registrable_domain(host)


# ---------------------------------------------------------------- rules


@dataclass
class ResponseView:
    """What a rule may look at: one response, reduced to the fields rules test."""

    url: str
    method: str
    status: int
    headers: Mapping[str, str]  # lower-case names
    document: bool
    request_header_names: Iterable[str] = ()
    all_headers: Optional[Mapping[str, str]] = None  # with set-cookie, fetched on demand
    body: Optional[str] = None  # fetched on demand

    def __post_init__(self) -> None:
        parts = urlsplit(self.url)
        self.host_path = (parts.hostname or '') + parts.path
        self.query = parse_qs(parts.query)


@dataclass(frozen=True)
class Need:
    """A rule's other conditions hold, and it needs these to decide."""

    headers: bool
    body: bool


Observation = Tuple[str, str, bool, bool]  # provider, verdict, transient, opens


def _status_ok(status: int, wanted: List[str]) -> bool:
    return any(str(status) == w or (w.endswith('xx') and str(status)[0] == w[0]) for w in wanted)


def _rx(pattern: str) -> 're.Pattern[str]':
    return re.compile(pattern, re.IGNORECASE)


class Rules:
    def __init__(self, data: Mapping[str, Any] = RULES_DATA) -> None:
        self.providers: Dict[str, Dict[str, Any]] = {}
        for name, spec in data['providers'].items():
            edge = [(_rx(e['name']), _rx(e['value']) if 'value' in e else None) for e in spec.get('edge', [])]
            rules = []
            for r in spec['rules']:
                rules.append({
                    **r,
                    'url': _rx(r['url']) if 'url' in r else None,
                    'query': {k: _rx(v) for k, v in r.get('query', {}).items()},
                    'headers': {k: _rx(v) for k, v in r.get('headers', {}).items()},
                    'body': _rx(r['body']) if 'body' in r else None,
                    'request_header_name': _rx(r['request_header_name']) if 'request_header_name' in r else None,
                })
            self.providers[name] = {'edge': edge, 'rules': rules, 'unresolved': spec['unresolved']}

    @staticmethod
    def _edge(edge: List[Tuple['re.Pattern[str]', Any]], headers: Mapping[str, str]) -> bool:
        return any(
            name.search(k) and (value is None or value.search(v)) for name, value in edge for k, v in headers.items()
        )

    def classify(self, view: ResponseView) -> Union[Need, List[Observation]]:
        """The observations this response makes, or what has to be fetched first."""
        out: List[Observation] = []
        need_headers = need_body = False
        for name, provider in self.providers.items():
            is_edge = None
            for rule in provider['rules']:
                if rule.get('document') and not view.document:
                    continue
                if rule.get('method') and rule['method'] != view.method:
                    continue
                if rule['url'] and not rule['url'].search(view.host_path):
                    continue
                if 'status' in rule and not _status_ok(view.status, rule['status']):
                    continue
                if rule.get('edge'):
                    if is_edge is None:
                        is_edge = self._edge(provider['edge'], view.headers)
                    if not is_edge:
                        continue
                if any(not any(p.search(v) for v in view.query.get(k, [])) for k, p in rule['query'].items()):
                    continue
                if rule['request_header_name'] and not any(
                    rule['request_header_name'].search(h) for h in view.request_header_names
                ):
                    continue
                if rule['headers']:
                    if 'set-cookie' in rule['headers'] and view.all_headers is None:
                        need_headers = True
                        break
                    headers = view.all_headers if view.all_headers is not None else view.headers
                    if any(not p.search(headers.get(k, '')) for k, p in rule['headers'].items()):
                        continue
                if rule['body']:
                    if view.body is None:
                        need_body = True
                        break
                    if not rule['body'].search(view.body):
                        continue
                out.append((name, rule['verdict'], bool(rule.get('transient')), rule.get('opens', True)))
                break
        if need_headers or need_body:
            return Need(headers=need_headers, body=need_body)
        return out

    def unresolved(self, provider: str) -> str:
        return self.providers[provider]['unresolved']


# ---------------------------------------------------------------- encounters


@dataclass
class _Encounter:
    site: str
    blocked: bool = False
    challenged: bool = False  # a challenge that does not clear by itself
    last: Optional[str] = None  # 'success' or 'challenge' (transient), the latest


@dataclass
class Tally:
    """Encounters in progress and the outcome counts of finished ones."""

    rules: Rules
    counts: Dict[str, Dict[str, int]] = field(default_factory=dict)
    _open: Dict[Tuple[Any, str], _Encounter] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def observe(self, page: Any, site: str, observation: Observation) -> None:
        provider, verdict, transient, opens = observation
        with self._lock:
            key = (page, provider)
            enc = self._open.get(key)
            if enc and enc.site != site:
                self._finish(key)
                enc = None
            if enc is None:
                if not opens:
                    return
                enc = self._open[key] = _Encounter(site)
            if verdict == 'block':
                enc.blocked = True
            elif verdict == 'challenge' and not transient:
                enc.challenged = True
            elif verdict in ('success', 'challenge'):
                enc.last = verdict

    def navigated(self, page: Any, site: str) -> None:
        """A page's main frame now shows `site`: encounters on another site are over."""
        with self._lock:
            for key in [k for k, e in self._open.items() if k[0] == page and e.site != site]:
                self._finish(key)

    def close_page(self, page: Any) -> None:
        with self._lock:
            for key in [k for k in self._open if k[0] == page]:
                self._finish(key)

    def close_all(self) -> None:
        with self._lock:
            for key in list(self._open):
                self._finish(key)

    def take(self) -> Dict[str, Dict[str, int]]:
        """The finished counts, reset."""
        with self._lock:
            counts, self.counts = self.counts, {}
        return counts

    def _finish(self, key: Tuple[Any, str]) -> None:
        enc = self._open.pop(key)
        provider = key[1]
        if enc.blocked:
            outcome = 'block'
        elif enc.challenged or enc.last == 'challenge':
            outcome = 'challenge'
        elif enc.last == 'success':
            outcome = 'success'
        else:
            outcome = self.rules.unresolved(provider)
        row = self.counts.setdefault(provider, dict.fromkeys(OUTCOMES, 0))
        row[outcome] += 1


# ---------------------------------------------------------------- reporting


def _site(url: str) -> str:
    try:
        host = urlsplit(url).hostname
    except ValueError:
        return ''
    return registrable_domain(host) if host else ''


def _post(url: str, payload: Dict[str, Any]) -> None:
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST'
    )
    try:
        urllib.request.urlopen(request, timeout=SEND_TIMEOUT).close()
    except Exception:
        # Telemetry never affects a launch: an unreachable endpoint loses the report.
        pass


class Telemetry:
    """
    One launch's reporter. A launcher creates it when telemetry is enabled,
    hands it each browser context with `watch`, and calls `close` when the
    browser closes. Counts are sent every FLUSH_INTERVAL seconds and at close.
    """

    def __init__(
        self,
        product: Product,
        *,
        version: str,
        browser_version: str,
        pro: bool,
        cross_os: bool,
        passthrough: bool,
        proxy: Union[None, str, Mapping[str, Any]],
        rules: Optional[Rules] = None,
        send: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        interval: float = FLUSH_INTERVAL,
    ) -> None:
        self.endpoint = product.getenv('TELEMETRY_URL') or DEFAULT_ENDPOINT
        self.dimensions = {
            'product': product.name,
            'version': version,
            'browser_version': browser_version,
            'pro': bool(pro),
            'cross_os': bool(cross_os),
            'passthrough': bool(passthrough),
            # The domain is all that is kept of the proxy.
            'proxy_provider': proxy_provider(proxy),
        }
        self.rules = rules or Rules()
        self.tally = Tally(self.rules)
        self._send = send or _post
        self._interval = interval
        self._timer: Optional[threading.Timer] = None
        self._closed = False
        self._schedule()
        atexit.register(self.close)

    # -- reporting

    def payload(self, counts: Dict[str, Dict[str, int]]) -> Dict[str, Any]:
        return {'schema': SCHEMA, **self.dimensions, 'counts': counts}

    def flush(self, wait: bool = False) -> None:
        counts = self.tally.take()
        if not counts:
            return
        thread = threading.Thread(target=self._send, args=(self.endpoint, self.payload(counts)), daemon=not wait)
        thread.start()
        if wait:
            thread.join(SEND_TIMEOUT + 1)

    def _schedule(self) -> None:
        if self._closed or self._interval <= 0:
            return
        self._timer = threading.Timer(self._interval, self._tick)
        self._timer.daemon = True
        self._timer.start()

    def _tick(self) -> None:
        self.flush()
        self._schedule()

    def close(self) -> None:
        """Count every open encounter and send what is left. Safe to call twice."""
        if self._closed:
            return
        self._closed = True
        if self._timer:
            self._timer.cancel()
        self.tally.close_all()
        self.flush(wait=True)

    # -- listening

    def watch(self, context: Any) -> None:
        """Listen to a Playwright BrowserContext (sync or async API)."""
        is_async = inspect.iscoroutinefunction(context.new_page)
        context.on('response', self._on_response_async if is_async else self._on_response_sync)
        context.on('page', self._watch_page)
        for page in context.pages:
            self._watch_page(page)
        context.on('close', lambda *_: [self.tally.close_page(id(p)) for p in context.pages])

    def watch_browser(self, browser: Any) -> None:
        """Count and send everything when the browser closes or disconnects."""
        browser.on('disconnected', lambda *_: self.close())

    def _watch_page(self, page: Any) -> None:
        key = id(page)
        main = page.main_frame

        def navigated(frame: Any) -> None:
            if frame == main:
                self.tally.navigated(key, _site(frame.url))

        page.on('framenavigated', navigated)
        page.on('close', lambda *_: self.tally.close_page(key))

    @staticmethod
    def _view(response: Any) -> Optional[Tuple[int, str, ResponseView]]:
        try:
            page = response.frame.page
        except Exception:
            return None  # a service worker's response has no page
        request = response.request
        view = ResponseView(
            url=response.url,
            method=request.method,
            status=response.status,
            headers=response.headers,
            document=request.resource_type == 'document',
            request_header_names=request.headers.keys(),
        )
        return id(page), _site(page.main_frame.url), view

    def _record(self, page: int, site: str, observations: List[Observation]) -> None:
        for observation in observations:
            self.tally.observe(page, site, observation)

    def _on_response_sync(self, response: Any) -> None:
        try:
            seen = self._view(response)
            if not seen:
                return
            page, site, view = seen
            result = self.rules.classify(view)
            if isinstance(result, Need):
                if result.headers:
                    view.all_headers = response.all_headers()
                if result.body:
                    view.body = response.body()[:BODY_LIMIT].decode('utf-8', 'replace')
                result = self.rules.classify(view)
            if isinstance(result, list):
                self._record(page, site, result)
        except Exception:
            pass

    async def _on_response_async(self, response: Any) -> None:
        try:
            seen = self._view(response)
            if not seen:
                return
            page, site, view = seen
            result = self.rules.classify(view)
            if isinstance(result, Need):
                if result.headers:
                    view.all_headers = await response.all_headers()
                if result.body:
                    view.body = (await response.body())[:BODY_LIMIT].decode('utf-8', 'replace')
                result = self.rules.classify(view)
            if isinstance(result, list):
                self._record(page, site, result)
        except Exception:
            pass
