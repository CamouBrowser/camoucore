"""
The vfb path of camoucore.virtdisplay: what headless="virtual" runs on macOS
and Windows.

A fake vfb that speaks vfb's protocol -- the display (and, with -report
geometry, its desktop rectangle) on the -displayfd fd, exit when stdin closes
-- stands in for the real one, so the launch, report and stop logic is tested
on any POSIX runner with OS_NAME patched. Mirrors
typescript/tests/virtdisplay-vfb.test.ts.
"""

import json
import os
import stat
import subprocess  # nosec
import sys
from pathlib import Path

import pytest

from camoucore import virtdisplay
from camoucore.exceptions import CannotExecuteVfb, CannotFindVfb
from camoucore.virtdisplay import VFB_KEY, VirtualDisplay
from conftest import PRODUCT

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="the fake vfb is a script with a shebang"
)

FAKE = """#!{python}
import json, os, sys
argv = sys.argv[1:]
log = {log!r}
def note(**k):
    with open(log, "a") as f:
        f.write(json.dumps(k) + "\\n")
note(argv=argv)
fd = int(argv[argv.index("-displayfd") + 1])
os.write(fd, {report!r}.encode())
if fd != 1:
    os.close(fd)
else:
    sys.stdout.flush()
sys.stdin.buffer.read()
note(stopped="stdin closed")
"""


def _fake(tmp_path: Path, report: str = "7 -1440 0 1440 900 2\n") -> Path:
    log = tmp_path / "log.jsonl"
    path = tmp_path / "vfb"
    path.write_text(FAKE.format(python=sys.executable, log=str(log), report=report))
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def _log(tmp_path: Path) -> list:
    return [json.loads(line) for line in (tmp_path / "log.jsonl").read_text().splitlines()]


@pytest.fixture(params=["mac", "win"])
def host(request, monkeypatch, tmp_path):
    monkeypatch.setattr(virtdisplay, "OS_NAME", request.param)
    monkeypatch.setenv(PRODUCT.env_var(VFB_KEY), str(_fake(tmp_path)))
    return request.param


def test_reports_the_display_and_where_it_sits(host, tmp_path):
    vd = VirtualDisplay(PRODUCT)
    try:
        assert vd.get() == ":7"
        assert vd.bounds == (-1440, 0, 1440, 900)
        argv = _log(tmp_path)[0]["argv"]
        fd = argv[argv.index("-displayfd") + 1]
        # Windows children inherit no extra fd: vfb reports on stdout there.
        assert fd == "1" if host == "win" else fd not in ("0", "1", "2")
        assert argv[argv.index("-report") + 1] == "geometry"
        assert "-eofexit" in argv
        # -eofexit stops vfb when stdin closes, so stdin must stay open while
        # the display is in use: a /dev/null stdin would end it at once.
        with pytest.raises(subprocess.TimeoutExpired):
            vd.proc.wait(timeout=0.5)
    finally:
        vd.kill()


@pytest.mark.parametrize("report", ["5 3456 0 3456 2160 2\n", "5 3456 0 3456 2160 2.5\n"])
def test_window_fills_the_monitor_in_css_pixels(host, monkeypatch, tmp_path, report):
    # Windows reports device pixels and the user's display scaling; a window
    # sized in device pixels came out twice the monitor's width on win-i9.
    monkeypatch.setenv(PRODUCT.env_var(VFB_KEY), str(_fake(tmp_path, report)))
    vd = VirtualDisplay(PRODUCT)
    try:
        vd.get()
        scale = float(report.split()[5])
        assert vd.scale == scale
        if host == "win":
            assert vd.window == (3456, 0, round(3456 / scale), round(2160 / scale))
        else:
            assert vd.window == vd.bounds
    finally:
        vd.kill()


def test_a_vfb_that_reports_a_bad_scale_fails(host, monkeypatch, tmp_path):
    monkeypatch.setenv(PRODUCT.env_var(VFB_KEY), str(_fake(tmp_path, "5 0 0 3456 2160 0\n")))
    vd = VirtualDisplay(PRODUCT)
    with pytest.raises(CannotExecuteVfb):
        vd.get()
    assert vd.proc is None


def _dying(tmp_path: Path, stderr: str) -> Path:
    path = tmp_path / "vfb-dies"
    path.write_text(f"#!{sys.executable}\nimport sys\nsys.stderr.write({stderr!r})\nsys.exit(1)\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def test_a_vfb_that_fails_to_start_says_why(host, monkeypatch, tmp_path):
    # vfb explains a failure on stderr (no free monitor, a mode the driver
    # lacks); the error has to carry that, not just "did not report".
    why = "vfb: all 1 virtual monitors are in use; raise <monitors><count>"
    monkeypatch.setenv(PRODUCT.env_var(VFB_KEY), str(_dying(tmp_path, why + "\n")))
    vd = VirtualDisplay(PRODUCT)
    with pytest.raises(CannotExecuteVfb, match="raise <monitors><count>"):
        vd.get()
    assert vd.proc is None


def test_a_vfb_that_exits_silently_gives_its_exit_code(host, monkeypatch, tmp_path):
    # This path read the exit code after kill() had cleared the process, and
    # raised AttributeError instead of the error.
    monkeypatch.setenv(PRODUCT.env_var(VFB_KEY), str(_dying(tmp_path, "")))
    vd = VirtualDisplay(PRODUCT)
    with pytest.raises(CannotExecuteVfb, match="exit=1"):
        vd.get()
    assert vd.proc is None


def test_kill_lets_vfb_stop_itself_so_it_can_detach_its_monitor(host, tmp_path):
    # A killed vfb on Windows leaves its monitor attached to the desktop, so
    # kill() closes stdin and waits rather than sending a signal.
    vd = VirtualDisplay(PRODUCT)
    vd.get()
    proc = vd.proc
    vd.kill()
    assert vd.proc is None
    assert proc.returncode == 0
    assert _log(tmp_path)[-1] == {"stopped": "stdin closed"}


def test_starts_at_a_monitor_size_not_the_engines_tiny_root(host):
    assert PRODUCT.engine.virtual_screen != virtdisplay.VFB_DEFAULT_SCREEN
    assert VirtualDisplay(PRODUCT).screen == virtdisplay.VFB_DEFAULT_SCREEN


def test_fit_sizes_the_monitor(host, tmp_path):
    vd = VirtualDisplay(PRODUCT)
    vd.fit(2880, 1800, 2.0)
    try:
        vd.get()
        argv = _log(tmp_path)[0]["argv"]
        screen = argv[argv.index("-screen") + 2]
        if host == "mac":
            # A HiDPI mode: points, backed by 2x pixels.
            assert screen == "1440x900"
            assert argv[argv.index("-scale") + 1] == "2"
        else:
            assert screen == "2880x1800"
            assert "-scale" not in argv
    finally:
        vd.kill()


def test_a_missing_vfb_says_how_to_get_one(host, monkeypatch, tmp_path):
    monkeypatch.setenv(PRODUCT.env_var(VFB_KEY), str(tmp_path / "nowhere"))
    with pytest.raises(CannotFindVfb, match=PRODUCT.env_var(VFB_KEY)):
        VirtualDisplay(PRODUCT).get()


def test_a_vfb_that_reports_junk_fails_and_is_stopped(host, monkeypatch, tmp_path):
    monkeypatch.setenv(PRODUCT.env_var(VFB_KEY), str(_fake(tmp_path, report="oops\n")))
    vd = VirtualDisplay(PRODUCT)
    with pytest.raises(CannotExecuteVfb, match="oops"):
        vd.get()
    assert vd.proc is None
