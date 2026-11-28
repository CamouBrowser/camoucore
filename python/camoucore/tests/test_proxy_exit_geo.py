"""Where a proxy exits: its IP, timezone, country and position, looked up through it."""

from unittest import mock

import pytest

from camoucore import ip
from camoucore.exceptions import InvalidIP

EXIT = {
    "status": "success",
    "query": "203.0.113.7",
    "timezone": "Europe/Paris",
    "countryCode": "FR",
    "lat": 48.8566,
    "lon": 2.3522,
}


def _get(payload):
    response = mock.MagicMock()
    response.text = payload.get("query", "")
    response.json.return_value = payload
    return mock.Mock(return_value=response)


def test_the_exit_is_read_whole(monkeypatch):
    get = _get(EXIT)
    monkeypatch.setattr(ip.requests, "get", get)
    assert ip.proxy_exit_geo("http://u:p@proxy.example.com:8080") == ip.ExitGeo(
        "203.0.113.7", "Europe/Paris", "FR", 48.8566, 2.3522
    )
    expected = "http://u:p@proxy.example.com:8080"
    assert get.call_args.kwargs["proxies"] == {"http": expected, "https": expected}


@pytest.mark.parametrize("missing", ["query", "timezone", "countryCode", "lat", "lon"])
def test_a_lookup_missing_a_field_raises(monkeypatch, missing):
    partial = {key: value for key, value in EXIT.items() if key != missing}
    monkeypatch.setattr(ip.requests, "get", _get(partial))
    with pytest.raises(InvalidIP, match="webrtc_ip"):
        ip.proxy_exit_geo("http://proxy.example.com:8080")


def test_a_failed_lookup_raises(monkeypatch):
    monkeypatch.setattr(ip.requests, "get", mock.Mock(side_effect=ip.requests.ConnectionError("refused")))
    with pytest.raises(InvalidIP, match="webrtc_ip"):
        ip.proxy_exit_geo("http://proxy.example.com:8080")


def test_lookups_through_a_proxy_get_longer_than_direct_ones(monkeypatch):
    # A proxied probe adds a hop and a TLS handshake; 5 s failed whole launches
    # behind proxies that route the long way round.
    timeouts = []

    def get(url, **kwargs):
        timeouts.append((kwargs["timeout"], bool(kwargs.get("proxies"))))
        return _get(EXIT)()

    monkeypatch.setattr(ip.requests, "get", get)
    ip.public_ip.cache_clear()
    ip.public_ip()
    ip.public_ip("http://u:p@proxy.example.com:8080")
    ip.proxy_exit_geo("http://u:p@proxy.example.com:8080")
    ip.public_ip.cache_clear()
    assert timeouts == [
        (ip.DIRECT_IP_TIMEOUT, False),
        (ip.PROXIED_IP_TIMEOUT, True),
        (ip.PROXIED_IP_TIMEOUT, True),
    ]
    assert ip.PROXIED_IP_TIMEOUT > ip.DIRECT_IP_TIMEOUT


def test_a_socks5_proxy_is_reachable():
    """requests needs PySocks for a socks5 proxy; without it every socks5 exit
    lookup failed with "Missing dependencies for SOCKS support"."""
    adapter = ip.requests.adapters.HTTPAdapter()
    manager = adapter.proxy_manager_for("socks5://u:p@127.0.0.1:1080")
    assert type(manager).__name__ == "SOCKSProxyManager"
