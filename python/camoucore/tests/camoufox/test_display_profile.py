"""A caller's display ICC profile (display_profile.py).

Stock Firefox converts ICC-tagged images to the display's profile, and a page
reads the result off a canvas. gfx.color_management.display_profile, a stock
pref read before the OS profile on every platform, points the browser at the
caller's profile. Without one the launcher sets nothing, for any identity.
"""

import struct
from pathlib import Path

import pytest

from camoucore.camoufox import display_profile as dp
from camoucore.camoufox import utils

from test_launch_environment import isolated_launch_dependencies  # noqa: F401

WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0"
LIN_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:159.0) Gecko/20100101 Firefox/159.0"
PREF = "gfx.color_management.display_profile"


def icc(tag: bytes) -> bytes:
    """A minimal byte string the launcher accepts as an ICC profile, told apart by `tag`."""
    body = tag.ljust(16, b"\0")
    header = struct.pack(">I", 128 + 4 + len(body)) + b"\0" * 32 + b"acsp" + b"\0" * 88
    return header + struct.pack(">I", 0) + body


OTHER = icc(b"other")


@pytest.fixture(autouse=True)
def cache(monkeypatch, tmp_path):
    monkeypatch.setattr(dp, "_cache_dirs", lambda: [tmp_path / "display-profiles"])


@pytest.fixture
def launch(monkeypatch, isolated_launch_dependencies):  # noqa: F811
    """launch_options on a Linux host; returns the prefs."""
    monkeypatch.setattr(utils, "_host_os_key", lambda: "lin")
    monkeypatch.setattr(utils, "get_env_vars", lambda *a, **k: {})

    def run(ua=WIN_UA, config=None, **kwargs):
        config = {"navigator.userAgent": ua, **(config or {})}
        return utils.launch_options(config=config, i_know_what_im_doing=True, **kwargs)["firefox_user_prefs"]

    return run


def profile_of(prefs) -> bytes:
    return Path(prefs[PREF]).read_bytes()


class TestLaunch:
    def test_caller_bytes_reach_the_pref(self, launch):
        prefs = launch(display_profile=OTHER)
        assert profile_of(prefs) == OTHER

    def test_caller_path_reaches_the_pref(self, launch, tmp_path):
        f = tmp_path / "display.icm"
        f.write_bytes(OTHER)
        assert profile_of(launch(display_profile=str(f))) == OTHER

    @pytest.mark.parametrize("option", [None, True, False])
    def test_no_profile_keeps_the_browsers_own(self, launch, option):
        assert PREF not in launch(display_profile=option)
        assert PREF not in launch(ua=LIN_UA, display_profile=option)

    def test_same_identity_same_file(self, launch):
        a = launch(display_profile=OTHER)[PREF]
        b = launch(display_profile=OTHER)[PREF]
        assert a == b

    def test_callers_pref_wins(self, launch):
        assert launch(display_profile=OTHER, firefox_user_prefs={PREF: "/x.icc"})[PREF] == "/x.icc"

    def test_host_os_identity_still_takes_the_callers(self, launch):
        assert profile_of(launch(ua=LIN_UA, display_profile=OTHER)) == OTHER

    def test_not_an_icc_profile_is_refused(self, launch):
        with pytest.raises(ValueError):
            launch(display_profile=b"\x89PNG not a profile" * 10)


def _reduce_script():
    import importlib.util

    path = Path(__file__).resolve().parents[2] / "scripts" / "camoufox" / "reduce-icc-profile.py"
    spec = importlib.util.spec_from_file_location("reduce_icc_profile", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _profile_with(tags):
    """An ICC profile holding `tags` [(sig, data)]; equal data blocks are shared, as rTRC=gTRC=bTRC often are."""
    table, body, offsets = [], b"", {}
    start = 128 + 4 + 12 * len(tags)
    for sig, data in tags:
        if data not in offsets:
            offsets[data] = start + len(body)
            body += data + b"\0" * (-len(data) % 4)
        table.append(struct.pack(">4sII", sig, offsets[data], len(data)))
    header = bytearray(128)
    header[12:24] = b"mntrRGB XYZ "
    header[36:40] = b"acsp"
    header[84:100] = b"\x11" * 16
    out = bytearray(header) + struct.pack(">I", len(tags)) + b"".join(table) + body
    out[0:4] = struct.pack(">I", len(out))
    return bytes(out)


def _tags(profile):
    n = struct.unpack(">I", profile[128:132])[0]
    return [struct.unpack(">4sII", profile[132 + 12 * i:144 + 12 * i]) for i in range(n)]


class TestReduceScript:
    def test_keeps_only_what_qcms_reads(self):
        trc = b"para" + b"\0" * 12
        xyz = [b"XYZ \0\0\0\0" + bytes([i]) * 12 for i in range(3)]
        full = _profile_with([
            (b"desc", b"mluc" + b"x" * 40), (b"chad", b"sf32" + b"\1" * 40), (b"rXYZ", xyz[0]), (b"gXYZ", xyz[1]),
            (b"bXYZ", xyz[2]), (b"rTRC", trc), (b"gTRC", trc), (b"bTRC", trc), (b"wtpt", b"XYZ " + b"\2" * 16),
            (b"DVB1", b"DVB1" + b"\3" * 600),
        ])
        reduced = _reduce_script().reduce_icc(full)
        dp.check_icc(reduced)
        assert int.from_bytes(reduced[:4], "big") == len(reduced) < len(full)
        assert reduced[84:100] == b"\0" * 16  # the profile ID no longer matches the content
        assert reduced[4:84] == full[4:84] and reduced[100:128] == full[100:128]
        tags = {sig: (off, n) for sig, off, n in _tags(reduced)}
        assert set(tags) == {b"chad", b"rXYZ", b"gXYZ", b"bXYZ", b"rTRC", b"gTRC", b"bTRC"}
        assert tags[b"rTRC"] == tags[b"gTRC"] == tags[b"bTRC"]  # still one shared curve
        old = {sig: full[off:off + n] for sig, off, n in _tags(full)}
        assert all(reduced[off:off + n] == old[sig] for sig, (off, n) in tags.items())
        assert all(off % 4 == 0 for off, _ in tags.values())

    def test_refuses_what_is_not_a_display_profile(self):
        with pytest.raises(ValueError):
            _reduce_script().reduce_icc(b"\x89PNG" * 40)
        with pytest.raises(ValueError, match="none of the tags"):
            _reduce_script().reduce_icc(_profile_with([(b"desc", b"mluc" + b"x" * 40)]))
