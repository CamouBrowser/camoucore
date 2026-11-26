"""Camoufox Pro's options before Pro launches: a standard build refuses them with
the page where an account is made, before anything is downloaded; a Pro build,
or a process pointed at a Pro API, launches them as before."""

import json

import pytest
from click.testing import CliRunner

from camoucore.pro import PRO_OPTIONS, early_access_url

from camoufox import multiversion, pkgman, pro, utils
from camoufox.__main__ import cli
from camoufox.exceptions import ProNotLaunched
from camoufox.product import PRODUCT

EARLY_ACCESS_URL = 'https://camoufox.com/early-access/'
BUILD_HASH = 'sha256:' + '0' * 64

ASKS = {
    'pro_key': 'cfp_live_x',
    'profile': 'shop-account-1',
    'warm_plan': 'none',
    'managed': True,
    'farm_gpu': True,
}


@pytest.fixture(autouse=True)
def no_pro_api(monkeypatch):
    monkeypatch.delenv('CAMOUFOX_PRO_API', raising=False)
    monkeypatch.delenv('CAMOUFOX_EXECUTABLE_PATH', raising=False)


@pytest.fixture
def nothing_installed(monkeypatch, tmp_path):
    """No browser is installed, and installing one fails the test: resolving the
    browser is where a launch downloads it."""

    def download(*_args, **_kwargs):
        raise AssertionError('downloaded')

    monkeypatch.setattr(multiversion, 'get_active_path', lambda: None)
    monkeypatch.setattr(utils, 'INSTALL_DIR', tmp_path / 'empty')
    monkeypatch.setattr(pkgman, 'camoufox_path', download)
    monkeypatch.setattr(pkgman.CamoufoxFetcher, 'install', download)
    monkeypatch.setattr(utils, 'installed_verstr', download)
    monkeypatch.setattr(utils, 'ensure_browser_profile_dir', download)


def build(tmp_path, pro_build):
    directory = tmp_path / 'build'
    directory.mkdir()
    (directory / 'properties.json').write_text(json.dumps([{'property': 'screen.width', 'type': 'uint'}]))
    if pro_build:
        (directory / 'pro-build.json').write_text(
            json.dumps({'build_hash': BUILD_HASH, 'version': '156.0.1-pro.1', 'target': 'linux-x86_64'})
        )
    return directory / 'camoufox-bin'


def test_the_account_page_is_camoufoxs():
    assert early_access_url(PRODUCT) == EARLY_ACCESS_URL
    assert (PRODUCT.site, PRODUCT.captcha_endpoint) == ('https://camoufox.com', 'https://captcha.camoufox.com/v1')


def test_every_pro_option_is_covered():
    assert set(ASKS) == set(PRO_OPTIONS)


@pytest.mark.parametrize('option', sorted(ASKS))
def test_a_pro_option_points_at_early_access_before_anything_is_downloaded(option, nothing_installed):
    with pytest.raises(ProNotLaunched, match=option) as raised:
        utils.launch_options(headless=True, **{option: ASKS[option]})
    assert EARLY_ACCESS_URL in str(raised.value)
    assert (raised.value.option, raised.value.url) == (option, EARLY_ACCESS_URL)


@pytest.mark.parametrize('option', sorted(ASKS))
def test_a_standard_executable_refuses_them_too(option, tmp_path, monkeypatch):
    monkeypatch.setattr(utils, 'ensure_browser_profile_dir', lambda *a: pytest.fail('launch went on'))
    with pytest.raises(ProNotLaunched, match=option):
        utils.launch_options(headless=True, executable_path=build(tmp_path, False), **{option: ASKS[option]})


def test_values_that_ask_for_nothing_pro_launch_on_a_standard_build(tmp_path, monkeypatch):
    monkeypatch.setattr(utils, 'resolve_verstr', lambda *a: '152.0.4-beta.31')
    monkeypatch.setattr(utils, 'get_env_vars', lambda config, *a, **k: {})
    options = utils.launch_options(
        executable_path=build(tmp_path, False), os='windows', headless=True, i_know_what_im_doing=True,
        managed=False, farm_gpu=False,
    )
    assert not set(PRO_OPTIONS) & set(options)
    assert pro.LEASE_FILE_ENV not in options['env']


@pytest.mark.parametrize('pro_build, pro_api', [(True, False), (False, True)])
def test_a_pro_build_or_a_pro_api_skips_the_gate(pro_build, pro_api, tmp_path, monkeypatch):
    if pro_api:
        monkeypatch.setenv('CAMOUFOX_PRO_API', 'https://api.example.com')
    utils.check_pro_launch({'profile': 'shop-account-1'}, build(tmp_path, pro_build))


def test_with_a_pro_api_a_standard_build_keeps_its_own_refusal(tmp_path, monkeypatch):
    monkeypatch.setenv('CAMOUFOX_PRO_API', 'https://api.example.com')
    monkeypatch.setattr(utils, 'resolve_verstr', lambda *a: '152.0.4-beta.31')
    with pytest.raises(ValueError, match='need a Camoufox Pro build') as raised:
        utils.launch_options(executable_path=build(tmp_path, False), os='windows', headless=True, profile='p')
    assert not isinstance(raised.value, ProNotLaunched)


def test_the_installed_build_decides_without_downloading(tmp_path, monkeypatch, nothing_installed):
    assert not utils._launches_pro_build(None, None)
    executable = build(tmp_path, True)
    executable.write_bytes(b'')
    monkeypatch.setattr(multiversion, 'get_active_path', lambda: executable.parent)
    assert utils._launches_pro_build(None, None)


def test_login_says_where_to_make_an_account(monkeypatch):
    monkeypatch.setattr(pro, 'login', lambda **k: pytest.fail('signed in'))
    monkeypatch.setattr('camoufox.__main__._active_pro_build', lambda: None)
    result = CliRunner().invoke(cli, ['login'])
    assert result.exit_code == 1
    assert EARLY_ACCESS_URL in result.output
    assert 'has not launched' in result.output


def test_login_with_a_pro_api_signs_in(monkeypatch):
    monkeypatch.setenv('CAMOUFOX_PRO_API', 'https://api.example.com')
    monkeypatch.setattr('camoufox.__main__._active_pro_build', lambda: None)
    calls = []

    def login(**kwargs):
        calls.append(kwargs)
        return {'account': {'name': 'acct'}, 'user': {'github_login': 'someone'}, 'path': '/x'}

    monkeypatch.setattr(pro, 'login', login)
    result = CliRunner().invoke(cli, ['login'])
    assert result.exit_code == 0, result.output
    assert len(calls) == 1
    assert EARLY_ACCESS_URL not in result.output
