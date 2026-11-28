"""Rendering another OS is not this launcher's job.

Text layout, font defaults, codec answers and system colours come from the
platform code of the build the browser runs on. Making a Linux host render as
Windows or macOS takes browser patches no released Camoufox has, so the
launcher sets none of it: an identity of another OS gets what an identity of
the host's own gets, except the OS-keyed defaults stock Firefox itself has
(scrollbars, the wheel, the Windows behaviour prefs), which every release reads.
"""

import pytest

from camoucore.camoufox import utils

from test_launch_environment import isolated_launch_dependencies  # noqa: F401

WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0"
MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0"
LIN_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:159.0) Gecko/20100101 Firefox/159.0"


@pytest.fixture
def launch(monkeypatch, isolated_launch_dependencies):  # noqa: F811
    """launch_options on a Linux host; returns (config, prefs)."""
    monkeypatch.setattr(utils, "_host_os_key", lambda: "lin")
    seen = {}

    def capture(config, *args, **kwargs):
        seen["config"] = dict(config)
        return {}

    monkeypatch.setattr(utils, "get_env_vars", capture)

    def run(ua, **kwargs):
        config = {"navigator.userAgent": ua, **kwargs.pop("config", {})}
        prefs = utils.launch_options(config=config, i_know_what_im_doing=True, **kwargs)["firefox_user_prefs"]
        return seen["config"], prefs

    return run


@pytest.mark.parametrize("ua", [WIN_UA, MAC_UA])
def test_another_os_sets_no_rendering_prefs(launch, ua):
    config, prefs = launch(ua)
    assert [p for p in prefs if p.startswith("font.name") or p.startswith("font.default")] == []
    assert "ui.systemUsesDarkTheme" not in prefs
    assert [p for p in prefs if p.startswith("ui.") and p.endswith("color")] == []
    assert "media:spoof_codecs" not in config
    assert "fonts:metrics" not in config


def test_async_fallback_is_off_for_a_linux_identity_only(launch):
    """The Linux identity's .notdef fix, as upstream: other identities keep the default."""
    _, prefs = launch(LIN_UA)
    assert prefs["gfx.font_rendering.fallback.async"] is False
    for ua in (WIN_UA, MAC_UA):
        _, prefs = launch(ua)
        assert "gfx.font_rendering.fallback.async" not in prefs


def test_a_windows_font_list_is_not_expanded_with_legacy_aliases(launch):
    config, _ = launch(WIN_UA, config={"fonts": ["Arial", "Rockwell"]})
    assert config["fonts"] == ["Arial", "Rockwell"]
