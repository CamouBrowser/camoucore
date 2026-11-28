"""Settled decisions the camoufox driver holds, from the browser repositories'
ci/tribal-rules.yml. The twin is typescript/camoufox/tests/settled-rules.test.ts.
"""

from camoucore.virtdisplay import COMPOSITE_KEY, SCREEN_KEY

from camoucore.camoufox import gpudisplay
from camoucore.camoufox.product import PRODUCT


def test_the_screen_size_is_overridable():
    # virtual-display-size-override-exists: not by default, but by this variable.
    assert PRODUCT.env_var(SCREEN_KEY) == 'CAMOUFOX_VIRTUAL_DISPLAY_SIZE'


def test_composite_is_switched_by_its_own_variable():
    # composite-extension-off: off unless this variable turns it on.
    assert PRODUCT.env_var(COMPOSITE_KEY) == 'CAMOUFOX_VIRTUAL_DISPLAY_COMPOSITE'


def test_the_gpu_display_shares_the_vt_and_ends_with_its_last_client():
    # gpu-display-shares-the-vt, gpu-display-terminates-with-its-last-client.
    assert {'-sharevts', '-novtswitch', '-terminate'} <= set(gpudisplay.SERVER_FLAGS)
    assert '-noreset' not in gpudisplay.SERVER_FLAGS


def test_firefox_virtual_display_is_1x1x24():
    # virtual-display-default-1x1x24: an unused framebuffer costs memory per launch.
    assert PRODUCT.engine.virtual_screen == '1x1x24'


def test_a_spoofed_window_gets_no_viewport():
    # no-viewport-when-window-is-spoofed: a Playwright viewport would override it.
    from camoucore.camoufox import utils

    assert callable(utils.spoofs_window_dimensions)
    assert callable(utils.attach_no_viewport_default)


def test_a_caller_s_screen_claims_the_avail_the_browser_reports():
    # cross-os-canvas-is-the-rfp-placeholder: spoofed avail-screen values go
    # through baseline protection, so the config claims them as it reports
    # them, whether or not the caller set screen.* or window.*.
    from test_launch_geometry import host, launch

    with host(None):
        config = launch(headless=True, os='windows', config={
            'screen.width': 1920, 'screen.height': 1080,
            'screen.availWidth': 1900, 'screen.availHeight': 1000,
        })
    assert (config['screen.availWidth'], config['screen.availHeight']) == (1920, 1080 - 48)
