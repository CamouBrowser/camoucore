"""A Product names the launcher; two launchers in one process keep their own names."""

import warnings
from pathlib import Path

import pytest

from camoucore import CHROMIUM, FIREFOX, Product
from camoucore._warnings import _warn_from_caller
from camoucore.exceptions import VirtualDisplayNotSupported
from camoucore.virtdisplay import VirtualDisplay

FOX = Product('camoufox', 'Camoufox', FIREFOX, package=Path('/nonexistent/camoufox'))
WOLF = Product('camouwolf', 'Camouwolf', CHROMIUM, package=Path('/nonexistent/camouwolf'))


@pytest.fixture(autouse=True)
def no_overrides(monkeypatch):
    for product in (FOX, WOLF):
        monkeypatch.delenv(product.env_var('VIRTUAL_DISPLAY_SIZE'), raising=False)


def test_each_engine_gets_its_own_virtual_screen():
    assert VirtualDisplay(FOX).screen == '1x1x24'
    assert VirtualDisplay(WOLF).screen == '3840x2160x24'


def test_a_launcher_reads_only_its_own_environment(monkeypatch):
    monkeypatch.setenv('CAMOUWOLF_VIRTUAL_DISPLAY_SIZE', '1920x1080')
    assert VirtualDisplay(WOLF).screen == '1920x1080x24'
    assert VirtualDisplay(FOX).screen == '1x1x24'


def test_a_bad_override_names_the_launchers_variable(monkeypatch):
    monkeypatch.setenv('CAMOUFOX_VIRTUAL_DISPLAY_SIZE', 'big')
    with pytest.raises(VirtualDisplayNotSupported, match='CAMOUFOX_VIRTUAL_DISPLAY_SIZE'):
        VirtualDisplay(FOX)


def test_cache_directories_are_per_launcher():
    assert FOX.cache_dir.name == 'camoufox'
    assert WOLF.cache_dir.name == 'camouwolf'


def test_a_warning_skips_a_registered_launchers_frames(tmp_path):
    """A warning raised from inside a launcher points at the user's call."""
    package = tmp_path / 'launcher'
    package.mkdir()
    Product('inner', 'Inner', CHROMIUM, package=package)
    inner = package / 'inner.py'
    inner.write_text('from camoucore._warnings import _warn_from_caller\n'
                     'def go():\n    _warn_from_caller("leak", RuntimeWarning)\n')
    namespace: dict = {}
    exec(compile(inner.read_text(), str(inner), 'exec'), namespace)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        namespace['go']()
    assert [Path(w.filename) for w in caught] == [Path(__file__)]
    assert _warn_from_caller  # the import above is the one the launcher uses


def test_fit_resizes_only_a_display_nobody_sized(monkeypatch):
    drawn = VirtualDisplay(WOLF)
    drawn.fit(2880, 1800)
    assert drawn.screen == '2880x1800x24'

    chosen = VirtualDisplay(WOLF, screen='1920x1080x24')
    chosen.fit(2880, 1800)
    assert chosen.screen == '1920x1080x24'

    monkeypatch.setenv('CAMOUWOLF_VIRTUAL_DISPLAY_SIZE', '1600x900')
    fixed = VirtualDisplay(WOLF)
    fixed.fit(2880, 1800)
    assert fixed.screen == '1600x900x24'
