"""
Who resolves names behind a proxy.

The proxy does unless the caller picks `proxy_dns='doh'` behind a SOCKS5 proxy:
then the browser resolves by DoH through the proxy. An HTTP proxy is always
given names. The default is 'exit' because no released browser yet carries
HTTP/3 over SOCKS5, the half that makes 'doh' match a Firefox at the exit.
"""

import pytest

from camoucore.camoufox import utils

SOCKS = {"server": "socks5://proxy.example:1080", "username": "u", "password": "p"}
DOH = {**utils.PROXY_DOH_PREFS, "network.trr.excluded-domains": "proxy.example"}


def _apply(proxy_dns, proxy, exit_looked_up=False, config=None, prefs=None):
    config = {} if config is None else config
    prefs = {} if prefs is None else prefs
    utils.apply_proxy_dns(proxy_dns, proxy, config, prefs, exit_looked_up)
    return config, prefs


@pytest.mark.parametrize("proxy_dns", [None, "exit"])
def test_names_go_to_the_proxy_by_default(proxy_dns, monkeypatch):
    monkeypatch.setattr(utils, "public_ipv6", lambda proxy: pytest.fail("looked up"))
    assert _apply(proxy_dns, SOCKS, exit_looked_up=True) == ({}, {})


def test_doh_resolves_through_the_socks5_proxy():
    assert utils.PROXY_DOH_PREFS["network.trr.mode"] == 3
    assert _apply("doh", SOCKS) == ({}, DOH)


def test_a_proxy_named_by_address_needs_no_exclusion():
    for server in ("socks5://127.0.0.1:1080", "socks5://[2001:db8::1]:1080"):
        assert _apply("doh", {"server": server}) == ({}, utils.PROXY_DOH_PREFS)


@pytest.mark.parametrize("proxy", [None, {"server": "http://proxy.example:8080"}, {"server": "proxy.example:8080"},
                                   {"server": "socks4://proxy.example:1080"}])
def test_only_socks5_resolves_by_doh(proxy):
    assert _apply(None, proxy) == ({}, {})
    assert _apply("exit", proxy) == ({}, {})
    with pytest.raises(ValueError, match="socks5"):
        _apply("doh", proxy)


def test_unknown_mode_raises():
    with pytest.raises(ValueError, match="proxy_dns"):
        _apply("system", SOCKS)


def test_caller_prefs_are_kept():
    mine = {"network.trr.uri": "https://dns.example/dns-query", "network.trr.excluded-domains": "a.example"}
    _, prefs = _apply("doh", SOCKS, prefs=dict(mine))
    assert prefs == {**mine, "network.trr.mode": 3}


@pytest.mark.parametrize("ipv6, expected", [(None, {"network:ipv4Only": True}), ("2001:db8::7", {})])
def test_exit_without_ipv6_is_an_ipv4_only_network(monkeypatch, ipv6, expected):
    asked = []
    monkeypatch.setattr(utils, "public_ipv6", lambda proxy: asked.append(proxy) or ipv6)
    assert _apply("doh", SOCKS, exit_looked_up=True)[0] == expected
    assert asked == ["socks5://u:p@proxy.example:1080"]


def test_exit_ipv6_is_not_asked_when_already_known(monkeypatch):
    monkeypatch.setattr(utils, "public_ipv6", lambda proxy: pytest.fail("looked up"))
    assert _apply("doh", SOCKS, exit_looked_up=False)[0] == {}
    for known in ({"webrtc:ipv6": "2001:db8::7"}, {"network:ipv4Only": False}):
        assert _apply("doh", SOCKS, exit_looked_up=True, config=dict(known))[0] == known


def test_the_launch_has_no_optimistic_data_option():
    """The SOCKS5 optimistic-data pref needs a browser patch no release has."""
    import inspect

    assert "proxy_optimistic_data" not in inspect.signature(utils.launch_options).parameters
