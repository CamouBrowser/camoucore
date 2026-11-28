"""
A config key the browser no longer reads stays in browser/settings/properties.json,
marked "removed" (#835).

Libraries up to 0.4.x raise UnknownProperty on any key the installed browser's
properties.json does not declare, and they still send navigator.appCodeName and
the other keys #787 deleted, so every release after that failed to launch under
them. Keeping the entries fixes those libraries; this library must in turn not
validate a removed key as a live one, and must say that it has no effect.
"""

import json

import pytest

from camoucore.camoufox import utils
from camoucore.camoufox._warnings import LeakWarning
from camoucore.camoufox.exceptions import UnknownProperty
from camoucore.camoufox.utils import validate_config


def _browser_with(tmp_path, entries):
    (tmp_path / "properties.json").write_text(json.dumps(entries))
    return tmp_path / "camoufox-bin"


def test_a_removed_key_is_skipped_with_its_release(tmp_path, capsys):
    binary = _browser_with(tmp_path, [
        {"property": "navigator.userAgent", "type": "str"},
        {"property": "navigator.appCodeName", "type": "str", "removed": "156.0.1-beta.32"},
    ])
    validate_config({"navigator.appCodeName": "Mozilla", "navigator.userAgent": "x"}, path=binary)
    assert "navigator.appCodeName: removed in 156.0.1-beta.32" in capsys.readouterr().out


def test_a_removed_key_is_not_type_checked(tmp_path):
    """Its type is whatever older libraries sent; it is never validated again."""
    binary = _browser_with(tmp_path, [
        {"property": "navigator.languages", "type": "array", "removed": "156.0.1-beta.32"},
    ])
    validate_config({"navigator.languages": "not-an-array"}, path=binary)


def test_a_build_without_the_voice_grid_warns_and_launches(tmp_path, monkeypatch):
    """A new library launches an older build (#835), but a Linux identity there reports no voices."""
    monkeypatch.delenv("CAMOUFOX_STRICT_CONFIG")
    binary = _browser_with(tmp_path, [{"property": "navigator.userAgent", "type": "str"}])
    with pytest.warns(LeakWarning, match="voices:speechd"):
        validate_config({"voices:speechd": {"languages": [], "variants": []}}, path=binary)


def test_an_unknown_key_is_skipped_by_default(tmp_path, monkeypatch, capsys):
    """Users keep launching an older build: the key is reported, never fatal."""
    monkeypatch.delenv("CAMOUFOX_STRICT_CONFIG")
    binary = _browser_with(tmp_path, [{"property": "navigator.userAgent", "type": "str"}])
    validate_config({"fonts:metrics": "windows", "navigator.userAgent": "x"}, path=binary)
    assert "Skipping unknown patch fonts:metrics" in capsys.readouterr().out


@pytest.mark.parametrize("value", ["1", "true", "yes"])
def test_strict_mode_rejects_an_unknown_key(tmp_path, monkeypatch, value):
    """CI's integration job sets CAMOUFOX_STRICT_CONFIG against the newest release,
    so the launcher cannot ship a writer for a key no released browser reads."""
    monkeypatch.setenv("CAMOUFOX_STRICT_CONFIG", value)
    binary = _browser_with(tmp_path, [{"property": "navigator.userAgent", "type": "str"}])
    with pytest.raises(UnknownProperty, match="fonts:metrics"):
        validate_config({"fonts:metrics": "windows", "navigator.userAgent": "x"}, path=binary)
    assert issubclass(UnknownProperty, KeyError)


@pytest.mark.parametrize("value", ["", "0", "false"])
def test_strict_mode_off_values(tmp_path, monkeypatch, value):
    monkeypatch.setenv("CAMOUFOX_STRICT_CONFIG", value)
    binary = _browser_with(tmp_path, [{"property": "navigator.userAgent", "type": "str"}])
    validate_config({"fonts:metrics": "windows"}, path=binary)


# The keys 0.6.0 wrote that v159.0-beta.43, the newest release, does not read.
UNRELEASED_KEYS = (
    "AudioContext:outputLatencyDelayMs", "fonts:metrics", "fonts:windowsAliasLoadMs",
    "fonts:windowsCmapLoadMs", "geolocation:systemPermission", "media:hwCodecs",
    "mediaDevices:microphoneChannels", "mediaDevices:webcamMaxFrameRates",
    "mediaDevices:webcamMaxHeights", "mediaDevices:webcamMaxWidths", "webrtc:hostipv6",
)


@pytest.mark.parametrize("os_name", ["windows", "macos", "linux"])
@pytest.mark.parametrize("host", ["lin", "win", "mac"])
def test_no_launch_writes_a_key_the_release_lacks(monkeypatch, os_name, host):
    """Real draws on every host, validated strictly (conftest sets
    CAMOUFOX_STRICT_CONFIG) against the release's properties.json, the snapshot
    in tests/camoufox/data: a writer for any other key raises UnknownProperty."""
    monkeypatch.setattr(utils, "_host_os_key", lambda: host)
    monkeypatch.setattr(utils, "add_default_addons", lambda *args, **kwargs: None)
    monkeypatch.setattr(utils, "installed_verstr", lambda: "159.0-beta.43")
    monkeypatch.setattr(utils, "launch_path", lambda: "/test/camoufox")
    sent = {}
    monkeypatch.setattr(utils, "get_env_vars", lambda config, *a, **k: sent.update(config) or {})
    for _ in range(5):
        utils.launch_options(os=os_name, i_know_what_im_doing=True, headless=True)
        assert sent and not set(UNRELEASED_KEYS) & set(sent)
