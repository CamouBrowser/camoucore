"""Settled decisions about the virtual display, held for every launcher.

The driver halves of the browser repositories' ci/tribal-rules.yml
(displayfd-not-lockfile-scan, displayfd-read-timeout). The twin is
typescript/camoucore/tests/settled-rules.test.ts.
"""

import inspect

from camoucore import virtdisplay


def test_displays_are_claimed_with_displayfd():
    # A userspace lock-file scan raced when many launches started at once: the
    # server binds the first free socket itself and reports it down a pipe.
    source = inspect.getsource(virtdisplay.VirtualDisplay.get)
    assert '"-displayfd"' in source


def test_the_displayfd_read_is_bounded():
    # A hung Xvfb with no timeout blocks the launch forever with no diagnostic.
    assert isinstance(virtdisplay.DISPLAYFD_READ_TIMEOUT_S, (int, float))
    assert virtdisplay.DISPLAYFD_READ_TIMEOUT_S > 0
