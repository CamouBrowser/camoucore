"""Settled decisions the camouwolf driver holds, from the browser repositories'
ci/tribal-rules.yml. The twin is typescript/camouwolf/tests/settled-rules.test.ts.
"""

from camoucore.virtdisplay import COMPOSITE_KEY, SCREEN_KEY

from camouwolf import gpudisplay
from camouwolf.product import PRODUCT


def test_the_screen_size_is_overridable():
    # virtual-display-size-override-exists: not by default, but by this variable.
    assert PRODUCT.env_var(SCREEN_KEY) == 'CAMOUWOLF_VIRTUAL_DISPLAY_SIZE'


def test_composite_is_switched_by_its_own_variable():
    # composite-extension-off: off unless this variable turns it on.
    assert PRODUCT.env_var(COMPOSITE_KEY) == 'CAMOUWOLF_VIRTUAL_DISPLAY_COMPOSITE'


def test_the_gpu_display_shares_the_vt_and_ends_with_its_last_client():
    # gpu-display-shares-the-vt, gpu-display-terminates-with-its-last-client.
    assert {'-sharevts', '-novtswitch', '-terminate'} <= set(gpudisplay.SERVER_FLAGS)
    assert '-noreset' not in gpudisplay.SERVER_FLAGS
