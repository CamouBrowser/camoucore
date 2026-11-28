"""Proxy telemetry: each provider's verdicts, encounter outcomes, what a report holds, and the opt-outs."""

import json
from pathlib import Path
from typing import Dict, List, Optional

import pytest

from camoucore import FIREFOX, Product
from camoucore.telemetry import (
    RULES_DATA,
    Need,
    ResponseView,
    Rules,
    Tally,
    Telemetry,
    proxy_provider,
    registrable_domain,
    telemetry_enabled,
)

PRODUCT = Product('camoufox', 'Camoufox', FIREFOX, package=Path('/nonexistent/camoufox'), site='https://accounts.example', captcha_endpoint='https://captcha.example/v1')
RULES = Rules()
UUID = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b'


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for key in ('TELEMETRY', 'TELEMETRY_URL'):
        monkeypatch.delenv(PRODUCT.env_var(key), raising=False)
    monkeypatch.delenv('DO_NOT_TRACK', raising=False)


def view(url, status=200, headers=None, document=False, method='GET', body=None, all_headers=None, request_headers=()):
    return ResponseView(
        url=url,
        method=method,
        status=status,
        headers={k.lower(): v for k, v in (headers or {}).items()},
        document=document,
        request_header_names=request_headers,
        all_headers=all_headers,
        body=body,
    )


def classify(v: ResponseView):
    """Classify, fetching what a rule asks for the way the browser glue does."""
    result = RULES.classify(v)
    if isinstance(result, Need):
        if result.headers and v.all_headers is None:
            v.all_headers = dict(v.headers)
        if result.body and v.body is None:
            v.body = ''
        result = RULES.classify(v)
    assert isinstance(result, list)
    return [(p, verdict, transient) for p, verdict, transient, _ in result]


# ---------------------------------------------------------------- the rules file


def test_every_rule_names_a_known_verdict_and_unresolved_outcome():
    for name, spec in RULES_DATA['providers'].items():
        assert spec['unresolved'] in ('success', 'unknown'), name
        assert spec['rules'], name
        for rule in spec['rules']:
            assert rule['verdict'] in ('presence', 'success', 'challenge', 'block'), (name, rule)
            # A rule must be tied to the provider: one of its endpoints, its edge, or its request header.
            assert 'url' in rule or rule.get('edge') or 'request_header_name' in rule, (name, rule)


def test_a_body_is_read_only_from_a_provider_endpoint_or_a_provider_error_page():
    for name, spec in RULES_DATA['providers'].items():
        for rule in spec['rules']:
            if 'body' not in rule:
                continue
            on_endpoint = 'url' in rule
            on_error_page = rule.get('edge') and all(s[0] in '45' for s in rule.get('status', ['2xx']))
            assert on_endpoint or on_error_page, (name, rule)


def test_an_ordinary_response_matches_nothing_and_reads_nothing():
    assert RULES.classify(view('https://shop.example/', document=True)) == []
    assert RULES.classify(view('https://shop.example/api/cart', method='POST')) == []
    assert RULES.classify(view('https://shop.example/', status=403, document=True)) == []


# ---------------------------------------------------------------- per provider


def test_cloudflare():
    edge = {'cf-ray': '8a1b2c3d4e5f-LAX', 'server': 'cloudflare'}
    assert classify(view('https://a.example/', 403, {**edge, 'cf-mitigated': 'challenge'}, document=True)) == [
        ('cloudflare', 'challenge', True)
    ]
    blocked = view('https://a.example/', 403, edge, document=True, body='<title>Attention Required!</title> Sorry, you have been blocked')
    assert classify(blocked) == [('cloudflare', 'block', False)]
    assert classify(view('https://a.example/', 200, edge, document=True)) == [('cloudflare', 'success', False)]
    assert classify(view('https://a.example/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1')) == [
        ('cloudflare', 'presence', False)
    ]
    # Turnstile's own host is Turnstile, not the Cloudflare edge.
    assert classify(view('https://challenges.cloudflare.com/turnstile/v0/api.js')) == [('turnstile', 'presence', False)]


def test_cloudflare_403_without_its_error_page_is_no_verdict():
    edge = {'cf-ray': '8a1b2c3d4e5f-LAX'}
    assert classify(view('https://a.example/missing', 403, edge, document=True, body='Forbidden by the origin')) == []


def test_datadome():
    assert classify(view('https://geo.captcha-delivery.com/captcha/?initialCid=x&t=bv&cid=y')) == [
        ('datadome', 'block', False)
    ]
    assert classify(view('https://geo.captcha-delivery.com/captcha/?initialCid=x&t=fe&cid=y')) == [
        ('datadome', 'challenge', False)
    ]
    assert classify(view('https://geo.captcha-delivery.com/interstitial/?initialCid=x')) == [
        ('datadome', 'challenge', True)
    ]
    assert classify(view('https://api-js.datadome.co/js/', method='POST', body='{"status":200,"cookie":"datadome=x"}')) == [
        ('datadome', 'success', False)
    ]
    assert classify(view('https://shop.example/', 200, {'x-datadome': 'protected'}, document=True)) == [
        ('datadome', 'success', False)
    ]


def test_akamai():
    edge = {'server': 'AkamaiGHost'}
    denied = view('https://a.example/', 403, edge, document=True, body='<H1>Access Denied</H1> Reference&#32;#18.abc')
    denied.body = 'Access Denied ... Reference #18.abc'
    assert classify(denied) == [('akamai', 'block', False)]
    assert classify(view('https://a.example/_sec/cp_challenge/ak-challenge-4-3.htm')) == [('akamai', 'challenge', True)]
    sensor = view(
        'https://a.example/x7Gh/sensor', 201, {'akamai-grn': '0.1'}, method='POST',
        all_headers={'akamai-grn': '0.1', 'set-cookie': '_abck=ABC~0~YAAQ~-1~||; Path=/'},
    )
    assert classify(sensor) == [('akamai', 'success', False)]
    unvalidated = view(
        'https://a.example/x7Gh/sensor', 201, {'akamai-grn': '0.1'}, method='POST',
        all_headers={'akamai-grn': '0.1', 'set-cookie': '_abck=ABC~-1~YAAQ~-1~; Path=/'},
    )
    assert classify(unvalidated) == []


def test_perimeterx_kasada_imperva_awswaf():
    assert classify(view('https://collector-pxabc123.px-cloud.net/api/v2/collector', method='POST', body='{"do":["bake|_px3|330|abc"]}')) == [
        ('perimeterx', 'success', False)
    ]
    assert classify(view('https://captcha.px-cdn.net/PXabc/captcha.js')) == [('perimeterx', 'challenge', False)]

    kp = {'x-kpsdk-ct': 'abc'}
    assert classify(view('https://a.example/', 429, kp, document=True)) == [('kasada', 'challenge', True)]
    assert classify(view(f'https://a.example/{UUID}/{UUID}/tl', 200, method='POST')) == [('kasada', 'success', False)]
    assert classify(view(f'https://a.example/{UUID}/{UUID}/tl', 400, method='POST')) == [('kasada', 'block', False)]

    iv = {'x-iinfo': '1-2-3'}
    assert classify(view('https://a.example/', 403, iv, document=True, body='Request unsuccessful. Incapsula incident ID: 1')) == [
        ('imperva', 'block', False)
    ]
    assert classify(view('https://a.example/_Incapsula_Resource?SWJIYLWA=1')) == [('imperva', 'challenge', True)]

    assert classify(view('https://a.example/', 405, {'x-amzn-waf-action': 'captcha'}, document=True)) == [
        ('awswaf', 'challenge', False)
    ]


def test_captcha_widgets():
    assert classify(view('https://api.hcaptcha.com/getcaptcha/abc', method='POST', body='{"generated_pass_UUID":"P1_abc","pass":true}')) == [
        ('hcaptcha', 'success', False)
    ]
    assert classify(view('https://api.hcaptcha.com/getcaptcha/abc', method='POST', body='{"tasklist":[{}]}')) == [
        ('hcaptcha', 'challenge', False)
    ]
    assert classify(view('https://www.google.com/recaptcha/api2/payload?p=x&k=y')) == [('recaptcha', 'challenge', False)]
    assert classify(view('https://www.google.com/recaptcha/api2/reload?k=y', method='POST', body=')]}\'\n["rresp",null,null,null,null,"nocaptcha"]')) == [
        ('recaptcha', 'success', False)
    ]
    assert classify(view('https://client-api.arkoselabs.com/fc/gt2/public_key/ABC', method='POST', body='{"token":"1.2|r=us|sup=1|pk=ABC"}')) == [
        ('arkose', 'success', False)
    ]
    assert classify(view('https://client-api.arkoselabs.com/fc/gt2/public_key/ABC', method='POST', body='{"token":"1.2|r=us|pk=ABC"}')) == [
        ('arkose', 'challenge', False)
    ]
    assert classify(view('https://shop.queue-it.net/softblock/?c=shop')) == [('queueit', 'challenge', False)]
    assert classify(view('https://a.example/api', request_headers=['x-1a2b3c4d-a', 'accept'])) == [('shape', 'presence', False)]
    assert classify(view('https://h.online-metrix.net/fp/tags.js?org_id=x')) == [('threatmetrix', 'presence', False)]
    assert classify(view('https://www.google.com/js/bg/abc.js')) == [('botguard', 'presence', False)]


def test_a_url_rule_never_reads_the_query():
    # A page URL that only mentions a provider in its query is not the provider.
    assert classify(view('https://shop.example/search?q=captcha-delivery.com/captcha/')) == []


# ---------------------------------------------------------------- encounters


def finished(observations: List[tuple], provider: str = 'datadome') -> Dict[str, int]:
    tally = Tally(RULES)
    for verdict, transient, opens in observations:
        tally.observe(1, 'shop.example', (provider, verdict, transient, opens))
    tally.close_all()
    return tally.take().get(provider, {})


def test_an_encounter_counts_its_worst_outcome_once():
    assert finished([('presence', False, True), ('success', False, True)]) == {'success': 1, 'challenge': 0, 'block': 0, 'unknown': 0}
    assert finished([('challenge', False, True), ('success', False, True)])['challenge'] == 1
    assert finished([('success', False, True), ('block', False, True)])['block'] == 1


def test_a_transient_challenge_that_clears_is_a_success():
    assert finished([('challenge', True, True), ('success', False, True)])['success'] == 1
    assert finished([('challenge', True, True)])['challenge'] == 1


def test_presence_alone_counts_as_the_providers_unresolved_outcome():
    assert finished([('presence', False, True)], 'datadome')['success'] == 1
    assert finished([('presence', False, True)], 'hcaptcha')['unknown'] == 1


def test_a_verdict_that_does_not_open_needs_an_encounter():
    assert finished([('success', False, False)], 'cloudflare') == {}
    assert finished([('presence', False, True), ('success', False, False)], 'cloudflare')['success'] == 1


def test_navigating_to_another_site_closes_the_encounter():
    tally = Tally(RULES)
    tally.observe(1, 'a.example', ('datadome', 'challenge', False, True))
    tally.navigated(1, 'a.example')
    assert tally.take() == {}
    tally.navigated(1, 'b.example')
    assert tally.take() == {'datadome': {'success': 0, 'challenge': 1, 'block': 0, 'unknown': 0}}


def test_pages_keep_their_own_encounters():
    tally = Tally(RULES)
    tally.observe(1, 'a.example', ('datadome', 'block', False, True))
    tally.observe(2, 'a.example', ('datadome', 'success', False, True))
    tally.close_page(2)
    assert tally.take()['datadome']['success'] == 1
    tally.close_page(1)
    assert tally.take()['datadome']['block'] == 1


# ---------------------------------------------------------------- proxy provider


@pytest.mark.parametrize(
    'proxy, expected',
    [
        (None, 'none'),
        ({}, 'none'),
        ({'server': 'http://gate.smartproxy.com:7000', 'username': 'user-abc', 'password': 'hunter2'}, 'smartproxy.com'),
        ({'server': 'socks5://user:pass@pr.oxylabs.io:7777'}, 'oxylabs.io'),
        ('brd.superproxy.io:22225', 'superproxy.io'),
        ({'server': 'http://proxy.example.co.uk:8080'}, 'example.co.uk'),
        ({'server': 'http://203.0.113.9:8080'}, 'ip-address'),
        ({'server': 'http://[2001:db8::1]:8080'}, 'ip-address'),
        ({'server': 'socks5://127.0.0.1:1080'}, 'self-hosted'),
        ({'server': 'http://192.168.1.4:3128'}, 'self-hosted'),
        ({'server': 'socks5://100.101.102.103:1080'}, 'self-hosted'),
        ({'server': 'http://node.tailnet-abc.ts.net:1080'}, 'self-hosted'),
        ({'server': 'http://localhost:8080'}, 'self-hosted'),
    ],
)
def test_proxy_provider_keeps_only_the_domain(proxy, expected):
    assert proxy_provider(proxy) == expected


def test_registrable_domain():
    assert registrable_domain('a.b.example.com') == 'example.com'
    assert registrable_domain('example.com.au') == 'example.com.au'
    assert registrable_domain('x.example.com.au') == 'example.com.au'


# ---------------------------------------------------------------- reports


def reporter(sent: List[tuple], proxy=None) -> Telemetry:
    return Telemetry(
        PRODUCT, version='1.2.3', browser_version='146.0', pro=False, cross_os=True, passthrough=False,
        proxy=proxy, send=lambda url, payload: sent.append((url, payload)), interval=0,
    )


def test_a_report_holds_counts_and_launch_dimensions_only():
    sent: List[tuple] = []
    t = reporter(sent, {'server': 'http://user:secret@gate.smartproxy.com:7000', 'username': 'user-abc', 'password': 'hunter2'})
    t.tally.observe(1, 'shop.example', ('datadome', 'block', False, True))
    t.close()
    [(url, payload)] = sent
    assert url == 'https://api.camoufox.com/v1/telemetry/antibot'
    assert payload == {
        'schema': 1, 'product': 'camoufox', 'version': '1.2.3', 'browser_version': '146.0',
        'pro': False, 'cross_os': True, 'passthrough': False, 'proxy_provider': 'smartproxy.com',
        'counts': {'datadome': {'success': 0, 'challenge': 0, 'block': 1, 'unknown': 0}},
    }
    text = json.dumps(payload)
    for secret in ('user', 'secret', 'hunter2', 'gate.', '7000', 'shop.example'):
        assert secret not in text


def test_nothing_is_sent_without_an_encounter_and_close_sends_once():
    sent: List[tuple] = []
    t = reporter(sent)
    t.close()
    t.close()
    assert sent == []


def test_the_endpoint_can_be_overridden(monkeypatch):
    monkeypatch.setenv(PRODUCT.env_var('TELEMETRY_URL'), 'http://127.0.0.1:9/ingest')
    assert reporter([]).endpoint == 'http://127.0.0.1:9/ingest'


@pytest.mark.parametrize(
    'setting, env, expected',
    [
        (True, {}, True),
        (None, {}, True),
        (False, {}, False),
        (True, {'TELEMETRY': '0'}, False),
        (True, {'TELEMETRY': 'off'}, False),
        (True, {'TELEMETRY': '1'}, True),
        (True, {'DO_NOT_TRACK': '1'}, False),
        (True, {'DO_NOT_TRACK': '0'}, True),
    ],
)
def test_opt_out(monkeypatch, setting, env, expected):
    for key, value in env.items():
        monkeypatch.setenv(key if key == 'DO_NOT_TRACK' else PRODUCT.env_var(key), value)
    assert telemetry_enabled(PRODUCT, setting) is expected


# ---------------------------------------------------------------- browser glue


class FakeEmitter:
    def __init__(self) -> None:
        self.handlers: Dict[str, List] = {}

    def on(self, event, handler):
        self.handlers.setdefault(event, []).append(handler)

    def emit(self, event, *args):
        for handler in self.handlers.get(event, []):
            handler(*args)


class FakeFrame:
    def __init__(self, url: str, page: 'FakePage') -> None:
        self.url = url
        self.page = page


class FakePage(FakeEmitter):
    def __init__(self, url: str) -> None:
        super().__init__()
        self.main_frame = FakeFrame(url, self)

    def goto(self, url: str) -> None:
        self.main_frame.url = url
        self.emit('framenavigated', self.main_frame)


class FakeRequest:
    def __init__(self, method: str, resource_type: str) -> None:
        self.method = method
        self.resource_type = resource_type
        self.headers: Dict[str, str] = {}


class FakeResponse:
    def __init__(self, page: FakePage, url: str, status=200, headers=None, body=b'', document=False, method='GET'):
        self.frame = page.main_frame
        self.url = url
        self.status = status
        self.headers = headers or {}
        self.request = FakeRequest(method, 'document' if document else 'fetch')
        self._body = body
        self.body_reads = 0

    def body(self) -> bytes:
        self.body_reads += 1
        return self._body

    def all_headers(self) -> Dict[str, str]:
        return self.headers


class FakeContext(FakeEmitter):
    def __init__(self) -> None:
        super().__init__()
        self.pages: List[FakePage] = []

    def new_page(self) -> FakePage:  # sync, as in playwright.sync_api
        page = FakePage('about:blank')
        self.pages.append(page)
        self.emit('page', page)
        return page


def test_glue_counts_an_encounter_and_never_reads_a_page_body():
    sent: List[tuple] = []
    t = reporter(sent)
    ctx = FakeContext()
    t.watch(ctx)
    page = ctx.new_page()
    page.goto('https://shop.example/')
    ordinary = FakeResponse(page, 'https://shop.example/', 200, {'content-type': 'text/html'}, b'<html>secret</html>', document=True)
    ctx.emit('response', ordinary)
    ctx.emit('response', FakeResponse(page, 'https://geo.captcha-delivery.com/captcha/?t=fe'))
    ctx.emit('response', FakeResponse(page, 'https://api-js.datadome.co/js/', body=b'{"status":200}', method='POST'))
    page.goto('https://other.example/')
    t.close()
    assert ordinary.body_reads == 0
    assert sent[0][1]['counts'] == {'datadome': {'success': 0, 'challenge': 1, 'block': 0, 'unknown': 0}}


def test_glue_swallows_errors():
    t = reporter([])
    ctx = FakeContext()
    t.watch(ctx)
    page = ctx.new_page()

    class Broken(FakeResponse):
        def body(self):
            raise RuntimeError('target closed')

    ctx.emit('response', Broken(page, 'https://api.hcaptcha.com/getcaptcha/x', method='POST'))
    t.close()
