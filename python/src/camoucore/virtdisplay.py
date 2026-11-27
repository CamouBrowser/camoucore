"""The display headless="virtual" runs the browser on.

Linux uses Xvfb. macOS and Windows have no X server to give each browser a
private screen, so they use vfb (github.com/JWriter20/vfb), a small server
with Xvfb's command line that adds a real monitor to the logged-in desktop: a
CGVirtualDisplay on macOS, a Virtual Display Driver monitor on Windows. The
system compositor draws it on the GPU like a physical panel. The browser has
to put its window there itself, so on those systems `bounds` says where the
monitor sits on the desktop.
"""

import os
import queue
import signal
import select
import subprocess  # nosec
import tempfile
import threading
import time
from shutil import which
from typing import Dict, List, Optional, Tuple

from .exceptions import (
    CannotExecuteVfb,
    CannotExecuteXvfb,
    CannotFindVfb,
    CannotFindXvfb,
    VirtualDisplayNotSupported,
)
from .host import OS_NAME
from .product import Product

# Safe timeout for Xvfb writing display num, prevents infinite hang. A cold first
# Xvfb on a fresh host took 0.6-8.4 s to report, so 10 s
# failed launches that would have succeeded.
DISPLAYFD_READ_TIMEOUT_S = 30.0

# The Composite extension stays disabled (Xvfb's `-extension COMPOSITE`); the
# launcher's <NAME>_VIRTUAL_DISPLAY_COMPOSITE=1 enables it.
COMPOSITE_KEY = "VIRTUAL_DISPLAY_COMPOSITE"
# <NAME>_VIRTUAL_DISPLAY_SIZE="<width>x<height>[x<depth>]" fixes the screen
# geometry; otherwise it is the engine's (Engine.virtual_screen) until the
# launcher fit()s it to the identity.
SCREEN_KEY = "VIRTUAL_DISPLAY_SIZE"
# <NAME>_VFB_PATH names the vfb binary on macOS and Windows; otherwise it is
# looked up on PATH.
VFB_KEY = "VFB_PATH"
# The monitor size on macOS and Windows until the launcher fit()s it. A real
# monitor has to hold the browser's window, so Xvfb's tiny root won't do.
VFB_DEFAULT_SCREEN = "1920x1080x24"
# How long kill() lets vfb detach its monitor after stdin closes.
VFB_STOP_TIMEOUT_S = 5.0


def _resolve_screen(product: Product) -> str:
    """Screen geometry for Xvfb's -screen argument."""
    value = (product.getenv(SCREEN_KEY) or "").strip()
    if not value:
        return product.engine.virtual_screen
    parts = value.lower().split("x")
    if len(parts) not in (2, 3) or not all(p.isdigit() and int(p) > 0 for p in parts):
        raise VirtualDisplayNotSupported(
            f"{product.env_var(SCREEN_KEY)} must look like '1920x1080' or '1920x1080x24', "
            f"got {value!r}"
        )
    if len(parts) == 2:
        parts.append("24")
    return "x".join(parts)


class VirtualDisplay:
    """A private screen for the browser: Xvfb on Linux, vfb on macOS and Windows."""

    def __init__(
        self,
        product: Product,
        debug: bool = False,
        screen: Optional[str] = None,
        composite: Optional[bool] = None,
        scale: float = 1.0,
    ) -> None:
        self.product = product
        self.debug = debug
        #: A size the caller chose; fit() leaves it alone.
        self.fixed = bool(screen or (product.getenv(SCREEN_KEY) or "").strip())
        self.screen = screen or (
            _resolve_screen(product) if self.fixed or OS_NAME == "lin" else VFB_DEFAULT_SCREEN
        )
        if composite is None:
            composite = (product.getenv(COMPOSITE_KEY) or "0").strip() in ("1", "true")
        self.composite = composite
        #: Device pixels per point. vfb on macOS makes a HiDPI monitor from
        #: it; Xvfb draws at 1. Once vfb is up it holds the scale vfb
        #: reported, which on Windows is the user's display scaling.
        self.scale = scale
        self.proc: Optional[subprocess.Popen] = None
        self._stderr = None  # vfb's stderr, while it runs
        self._display: Optional[int] = None
        #: Where vfb's monitor sits on the desktop, as (x, y, width, height) in
        #: the desktop's units (points on macOS, pixels on Windows); None on
        #: Linux, where the display is the browser's alone.
        self.bounds: Optional[Tuple[int, int, int, int]] = None
        if OS_NAME != "lin":
            self._name = "vfb"
            self._error = CannotExecuteVfb

    @property
    def window(self) -> Optional[Tuple[int, int, int, int]]:
        """Where a browser window that fills the monitor goes, as (x, y,
        width, height): the position in desktop units and the size in the
        browser's CSS pixels. macOS desktop points are already CSS pixels;
        Windows desktop units are device pixels, so the size there is divided
        by the monitor's scale. None on Linux."""
        if self.bounds is None:
            return None
        x, y, width, height = self.bounds
        if OS_NAME == "win":
            return x, y, round(width / self.scale), round(height / self.scale)
        return self.bounds

    @property
    def size(self) -> Tuple[int, int]:
        """The display's width and height in pixels."""
        width, height = self.screen.lower().split('x')[:2]
        return int(width), int(height)

    def fit(self, width: int, height: int, scale: float = 1.0) -> None:
        """Size a display that is not yet started to `width` x `height` pixels
        at `scale` device pixels per point, unless its size was fixed."""
        if self.fixed or self.proc is not None:
            return
        depth = self.screen.lower().split('x')[2]
        self.screen = f"{width}x{height}x{depth}"
        self.scale = scale

    @property
    def xvfb_args(self) -> tuple:
        return (
            # fmt: off
            "-screen", "0", self.screen,
            "-ac",
            "-nolisten", "tcp",
            "-extension", "RENDER",
            "+extension", "GLX",
            "+extension" if self.composite else "-extension", "COMPOSITE",
            "-extension", "XVideo",
            "-extension", "XVideo-MotionCompensation",
            "-extension", "XINERAMA",
            "-fp", "built-ins",
            "-nocursor",
            "-br",
            # fmt: on
        )

    @property
    def xvfb_path(self) -> str:
        path = which("Xvfb")
        if not path:
            raise CannotFindXvfb("Please install Xvfb to use headless mode.")
        if not os.access(path, os.X_OK):
            raise CannotExecuteXvfb(f"I do not have permission to execute Xvfb: {path}")
        return path

    @property
    def setpriv_path(self) -> str:
        path = which("setpriv")
        if not path:
            raise CannotFindXvfb("Please install util-linux (for setpriv) to use headless mode.")
        return path

    @property
    def vfb_path(self) -> str:
        path = (self.product.getenv(VFB_KEY) or "").strip() or which("vfb")
        if not path or not os.path.isfile(path):
            raise CannotFindVfb(
                "headless='virtual' on this system needs vfb (https://github.com/JWriter20/vfb): "
                f"put it on PATH or set {self.product.env_var(VFB_KEY)} to its path."
            )
        if not os.access(path, os.X_OK):
            raise CannotExecuteVfb(f"I do not have permission to execute vfb: {path}")
        return path

    @property
    def vfb_args(self) -> tuple:
        width, height = self.size
        args = ["-report", "geometry", "-eofexit"]
        if OS_NAME == "mac" and self.scale >= 1.5:
            # vfb takes the mode in points and backs it with 2x pixels.
            args += ["-screen", "0", f"{round(width / 2)}x{round(height / 2)}", "-scale", "2"]
        else:
            args += ["-screen", "0", f"{width}x{height}"]
        return tuple(args)

    # What get() calls the server in its errors, and what it raises.
    _name = "Xvfb"
    _error = CannotExecuteXvfb

    def _wrapper(self) -> List[str]:
        """What execs the server. setpriv's parent-death signal stops Xvfb when
        this process dies without reaching kill(), even by SIGKILL; SIGTERM lets
        Xvfb remove its own lock and socket. vfb watches its parent itself."""
        if OS_NAME != "lin":
            return []
        return [self.setpriv_path, "--pdeathsig", "TERM"]

    def _command(self) -> List[str]:
        """The server's argv, less -displayfd, which get() adds."""
        if OS_NAME != "lin":
            return [self.vfb_path, *self.vfb_args]
        return [self.xvfb_path, *self.xvfb_args]

    def _server_env(self) -> Optional[Dict[str, str]]:
        if OS_NAME != "lin":
            return None
        # Force Mesa software GLX; we don't use the GPU anyway.
        return {**os.environ, "__GLX_VENDOR_LIBRARY_NAME": "mesa", "LIBGL_ALWAYS_SOFTWARE": "1"}

    def _starting(self) -> None:
        """Called about every 100ms while the server has not reported a display."""

    def _ready(self) -> None:
        """Called once the server has reported its display."""

    def get(self) -> str:
        if self.proc is None and OS_NAME == "win":
            self._report(self._start_over_stdout())
        elif self.proc is None:
            # Launch the server with -displayfd so it picks a free display
            # number atomically and reports it back. Avoids userspace races.
            # subprocess.Popen's pass_fds keeps an fd at its parent number in
            # the child (unlike Node's `stdio: [..., 'pipe']` which renumbers
            # to 3), so we tell the server that exact number.
            program, *args = self._command()
            read_fd, write_fd = os.pipe()
            cmd = [*self._wrapper(), program, "-displayfd", str(write_fd), *args]
            if self.debug:
                print("Starting virtual display:", " ".join(cmd))
            self.proc = subprocess.Popen(  # nosec
                cmd,
                # vfb runs until its stdin closes (-eofexit), so it gets a
                # pipe only this process holds.
                stdin=subprocess.DEVNULL if OS_NAME == "lin" else subprocess.PIPE,
                stdout=None if self.debug else subprocess.DEVNULL,
                stderr=self._server_stderr(),
                start_new_session=True,
                pass_fds=(write_fd,),
                env=self._server_env(),
            )
            os.close(write_fd)  # so the read end EOFs when the server closes its end

            buf = b""
            deadline = time.monotonic() + DISPLAYFD_READ_TIMEOUT_S
            try:
                while b"\n" not in buf:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        self.kill()
                        raise self._error(
                            f"{self._name} did not report a display within "
                            f"{int(DISPLAYFD_READ_TIMEOUT_S * 1000)}ms"
                        )
                    if not select.select([read_fd], [], [], min(remaining, 0.1))[0]:
                        self._starting()
                        continue
                    chunk = os.read(read_fd, 64)
                    if not chunk:
                        raise self._error(self._no_report(buf))
                    buf += chunk
            finally:
                os.close(read_fd)

            self._report(buf)
        elif self.debug:
            print(f"Using virtual display: {self._display}")

        return f":{self._display}"

    def _start_over_stdout(self) -> bytes:
        """Start vfb on Windows, where a child gets no inherited fd: it reports
        on stdout, and a closed stdin is its signal to stop."""
        cmd = [*self._command(), "-displayfd", "1"]
        if self.debug:
            print("Starting virtual display:", " ".join(cmd))
        self.proc = subprocess.Popen(  # nosec
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._server_stderr(),
            env=self._server_env(),
            # CREATE_NO_WINDOW: no console window flashes up for vfb.
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        lines: "queue.Queue[bytes]" = queue.Queue()
        stdout = self.proc.stdout
        assert stdout is not None
        threading.Thread(target=lambda: lines.put(stdout.readline()), daemon=True).start()
        try:
            line = lines.get(timeout=DISPLAYFD_READ_TIMEOUT_S)
        except queue.Empty:
            self.kill()
            raise self._error(
                f"{self._name} did not report a display within "
                f"{int(DISPLAYFD_READ_TIMEOUT_S * 1000)}ms"
            )
        if not line.endswith(b"\n"):
            raise self._error(self._no_report(line))
        return line

    def _server_stderr(self):
        """Xvfb's stderr is noise; vfb's is a reason (no free monitor, a mode the
        driver lacks), kept in a file for the error when vfb fails to start."""
        if self.debug:
            return None
        if OS_NAME == "lin":
            return subprocess.DEVNULL
        self._stderr = tempfile.TemporaryFile()
        return self._stderr

    def _no_report(self, got: bytes) -> str:
        """Stop the server that exited without a report, and say why."""
        assert self.proc is not None
        try:
            code = self.proc.wait(timeout=VFB_STOP_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            code = None
        why = b""
        if self._stderr is not None:
            self._stderr.seek(0)
            why = self._stderr.read()[-2000:].strip()
        self.kill()
        if why:
            return f"{self._name} did not report a display: {why.decode(errors='replace')}"
        return f"{self._name} did not report a display (got {got!r}, exit={code})"

    def _report(self, buf: bytes) -> None:
        """Take the server's report: "N", or vfb's "N X Y W H SCALE"."""
        fields = buf.split()
        try:
            self._display = int(fields[0])
            if len(fields) >= 5:
                x, y, width, height = (int(v) for v in fields[1:5])
                self.bounds = (x, y, width, height)
            if len(fields) >= 6:
                # The scale the system gave the monitor, which on Windows is
                # the user's display scaling, not one vfb chose.
                self.scale = float(fields[5])
                if not self.scale > 0:
                    raise ValueError(fields[5])
        except (ValueError, IndexError):
            self.kill()
            raise self._error(f"{self._name} wrote non-integer display: {buf!r}")
        self._ready()

    def kill(self) -> None:
        """Stop Xvfb if it is running, and remove its lock and socket either way.

        The cleanup deliberately does NOT depend on whether we did the killing.
        It used to: the whole body sat behind `self.proc.poll() is None`, so a
        display whose Xvfb had already died -- crashed, OOM-killed, or reaped
        with the browser's process group -- was never cleaned up at all.

        That is backwards. A SIGKILLed Xvfb never gets to remove its own socket,
        so the crash path is precisely the one where /tmp/.X11-unix/X<n> is left
        behind. Those accumulate, and because -displayfd scans upward for a free
        number, every stranded socket pushes the next display higher until a
        long-running host stops being able to allocate one.
        """
        if not self.proc:
            return

        if OS_NAME != "lin":
            # vfb leaves no files; its monitor goes with the process.
            self._stop_vfb()
            self.proc = None
            if self._stderr is not None:
                self._stderr.close()
                self._stderr = None
            return

        if self.proc.poll() is None:
            if self.debug:
                print("Terminating virtual display:", self._display)
            try:
                self.proc.send_signal(signal.SIGKILL)
                self.proc.wait(timeout=5)
            except Exception:
                pass
        elif self.debug:
            print("Virtual display already exited:", self._display)

        for path in (
            f"/tmp/.X{self._display}-lock",
            f"/tmp/.X11-unix/X{self._display}",
        ):
            try:
                os.remove(path)
            except OSError:
                # Missing is the normal case; anything else (a permission error
                # from a number another user has since claimed) must not take
                # down a teardown path.
                pass

        self.proc = None

    def _stop_vfb(self) -> None:
        """Close vfb's stdin so it detaches its monitor and exits, and kill it
        if it has not within VFB_STOP_TIMEOUT_S."""
        assert self.proc is not None
        if self.debug:
            print("Terminating virtual display:", self._display)
        for stream in (self.proc.stdin, self.proc.stdout):
            try:
                if stream:
                    stream.close()
            except OSError:
                pass
        try:
            self.proc.wait(timeout=VFB_STOP_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
