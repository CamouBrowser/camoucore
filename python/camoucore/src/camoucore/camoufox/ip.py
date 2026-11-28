"""
Camoufox's SOCKS5 proxy credentials, which Juggler sends itself, and the public
IPv6 lookup through a proxy. The rest of the proxy and public IP helpers are
camoucore.ip.
"""

import json
from functools import lru_cache
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlsplit

import requests
from camoucore.ip import DIRECT_IP_TIMEOUT, PROXIED_IP_TIMEOUT, Proxy, valid_ipv6

from .exceptions import InvalidProxy


def socks5_auth(proxy: Optional[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Splits a SOCKS5 proxy's username and password from what Playwright is given.

    Playwright refuses a `socks5://` proxy that has a username ("Browser does
    not support socks5 proxy authentication"), but Juggler can send them
    (RFC 1929). Returns the proxy without its credentials, and the credentials
    with the proxy's host and port, for Juggler; or the proxy unchanged and
    None when it is not SOCKS5 or has no credentials.
    """
    if not proxy or not (proxy.get('username') or proxy.get('password')):
        return proxy, None
    server = str(proxy.get('server', ''))
    # As Playwright reads the server: without a scheme, it is an HTTP proxy.
    url = urlsplit(server if '://' in server else 'http://' + server)
    if url.scheme.lower() != 'socks5' or not url.hostname:
        return proxy, None
    try:
        port = url.port
    except ValueError as e:
        raise InvalidProxy(f"Invalid proxy server: {server}") from e
    bare = {k: v for k, v in proxy.items() if k not in ('username', 'password')}
    return bare, {
        'host': url.hostname,
        'port': port,
        'username': proxy.get('username') or '',
        'password': proxy.get('password') or '',
    }


# The environment variable that carries a launch-level SOCKS5 proxy's
# credentials to Juggler (TargetRegistry.js), which clears it once read.
PROXY_AUTH_ENV = 'CAMOU_PROXY_AUTH'


def proxy_auth_env(auth: Dict[str, Any]) -> Dict[str, str]:
    """The environment that hands a launch-level proxy's credentials to Juggler."""
    return {PROXY_AUTH_ENV: json.dumps(auth, separators=(',', ':'))}


def proxy_auth_init_script(auth: Dict[str, Any]) -> str:
    """
    The init script that hands a context's SOCKS5 credentials to Juggler.

    Juggler takes it out of the context's init scripts (TargetRegistry.js), so
    it never reaches a page or a content process. It is valid JavaScript that
    does nothing, should a browser without that support run it.
    """
    return f"camoufoxProxyAuth: ({json.dumps(auth, separators=(',', ':'))});"


@lru_cache(maxsize=None)
def public_ipv6(proxy: Optional[str] = None) -> Optional[str]:
    """
    This host's public IPv6 address, or the exit's behind `proxy`; None when it
    has none it can reach the internet from. The hosts have AAAA records only,
    so an answer proves the route.

    camoucore.ip.public_ipv6 takes no proxy; this stays until it does.
    """
    for url in ("https://api6.ipify.org", "https://v6.ident.me"):
        try:
            resp = requests.get(
                url,
                proxies=Proxy.as_requests_proxy(proxy) if proxy else None,
                timeout=PROXIED_IP_TIMEOUT if proxy else DIRECT_IP_TIMEOUT,
                verify=True,
            )
            resp.raise_for_status()
        except requests.RequestException:
            continue
        ip = resp.text.strip()
        if valid_ipv6(ip):
            return ip
    return None
