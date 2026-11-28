"""passthrough=True refuses every option that would inject a fingerprint."""

import warnings
from pathlib import Path

import pytest

from camoucore import FIREFOX, Product
from camoucore._warnings import LeakWarning
from camoucore.passthrough import IDENTITY_OPTIONS, check_passthrough, passthrough_conflicts, warn_passthrough

FOX = Product('camoufox', 'Camoufox', FIREFOX, package=Path('/nonexistent/camoufox'), site='https://accounts.example')


def test_unset_and_behaviour_options_do_not_conflict():
    options = {name: None for name in IDENTITY_OPTIONS}
    options.update(config={}, fonts=[], custom_fonts_only=False, humanize=True, proxy={'server': 'http://p:1'},
                   block_images=True, headless='virtual')
    assert passthrough_conflicts(options) == []
    check_passthrough(FOX, options)


@pytest.mark.parametrize('name', IDENTITY_OPTIONS)
def test_each_identity_option_is_refused(name):
    with pytest.raises(ValueError, match=name):
        check_passthrough(FOX, {name: 'set'})


def test_the_message_names_every_conflict():
    with pytest.raises(ValueError) as e:
        check_passthrough(FOX, {'os': 'windows', 'locale': 'de-DE', 'geoip': True})
    assert 'os, locale, geoip' in str(e.value)
    assert 'Camoufox' in str(e.value)


def test_a_proxied_passthrough_warns_unless_silenced():
    with pytest.warns(LeakWarning, match='proxy'):
        warn_passthrough(FOX, {'server': 'http://p:1'}, None)
    with warnings.catch_warnings():
        warnings.simplefilter('error')
        warn_passthrough(FOX, {'server': 'http://p:1'}, True)
        warn_passthrough(FOX, None, None)
