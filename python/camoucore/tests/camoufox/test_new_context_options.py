"""new_context_options: what NewContext hands Playwright's new_context()."""

from camoucore.camoufox import fingerprints as fp
from camoucore.camoufox import utils

VIEWPORT = {'width': 1000, 'height': 700}


def test_a_callers_viewport_replaces_no_viewport():
    ident = {'context_options': {'no_viewport': True, 'user_agent': 'x'}}
    assert utils.new_context_options(ident, {'viewport': VIEWPORT}, None, None) == {
        'user_agent': 'x', 'viewport': VIEWPORT,
    }


def test_the_drawn_viewport_fits_the_drawn_screen():
    for seed in range(10):
        ident = fp.generate_context_fingerprint(os='linux')
        opts, config = ident['context_options'], ident['config']
        assert opts['viewport']['width'] <= config['screen.width']
        assert opts['viewport']['height'] <= config['screen.height']
