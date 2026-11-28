"""A launcher's defaults file, a user's overrides of it, and the caller's options over both."""

import json
from pathlib import Path

import pytest

from camoucore import FIREFOX, Product
from camoucore.settings import apply_defaults, load_defaults, user_defaults_path, write_user_defaults

FOX = Product('camoufox', 'Camoufox', FIREFOX, package=Path('/nonexistent/camoufox'))

PACKAGED = {
    '$schema': 'ignored',
    '_readme': 'ignored',
    'telemetry': {'default': True, 'about': 'Anti-bot outcome counts.', 'examples': [False]},
    'humanize': {'default': False, 'about': 'Human-like input.'},
    'locale': {'default': None, 'about': 'Locale.'},
}


@pytest.fixture
def packaged(tmp_path):
    path = tmp_path / 'camoufox.defaults.json'
    path.write_text(json.dumps(PACKAGED))
    return path


@pytest.fixture(autouse=True)
def user_dir(tmp_path, monkeypatch):
    monkeypatch.setenv('CAMOUFOX_DEFAULTS', str(tmp_path / 'user' / 'defaults.json'))
    return tmp_path / 'user' / 'defaults.json'


def test_packaged_defaults_alone(packaged):
    assert load_defaults(FOX, packaged) == {'telemetry': True, 'humanize': False, 'locale': None}


@pytest.mark.parametrize('entry', [False, {'default': False, 'about': 'x'}])
def test_user_file_overrides_in_short_or_documented_form(packaged, user_dir, entry):
    user_dir.parent.mkdir()
    user_dir.write_text(json.dumps({'telemetry': entry, 'locale': 'de-DE'}))
    assert load_defaults(FOX, packaged) == {'telemetry': False, 'humanize': False, 'locale': 'de-DE'}


def test_user_file_typo_is_an_error(packaged, user_dir):
    user_dir.parent.mkdir()
    user_dir.write_text(json.dumps({'telemetri': False}))
    with pytest.raises(ValueError, match='telemetri'):
        load_defaults(FOX, packaged)


def test_user_file_wrong_type_is_an_error(packaged, user_dir):
    user_dir.parent.mkdir()
    user_dir.write_text(json.dumps({'telemetry': 'no'}))
    with pytest.raises(ValueError, match='telemetry'):
        load_defaults(FOX, packaged)


def test_undocumented_packaged_option_is_an_error(tmp_path):
    path = tmp_path / 'd.json'
    path.write_text(json.dumps({'telemetry': {'default': True}}))
    with pytest.raises(ValueError, match='about'):
        load_defaults(FOX, path)


def test_caller_options_win_and_unset_ones_take_the_default():
    merged = apply_defaults({'telemetry': True, 'humanize': False}, {'telemetry': False, 'humanize': None})
    assert merged == {'telemetry': False, 'humanize': False}


def test_write_user_defaults_copies_once(packaged, user_dir):
    assert user_defaults_path(FOX) == user_dir
    assert write_user_defaults(FOX, packaged) == user_dir
    user_dir.write_text('{"telemetry": false}')
    write_user_defaults(FOX, packaged)
    assert user_dir.read_text() == '{"telemetry": false}'
