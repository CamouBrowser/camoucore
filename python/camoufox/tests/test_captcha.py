"""The captcha option: checked before the launch, and the launched browser's
`.captcha` solver after it."""

import asyncio
import json

import pytest

from camoucore.captcha import CAPTCHAKRAKEN_ENDPOINT, require_client

from camoufox import async_api, multiversion, pkgman, pro, sync_api, utils
from camoufox.exceptions import CaptchaKeyMissing, CaptchaKrakenMissing
from camoufox.product import PRODUCT

CK_KEY = 'ck_live_test'
ACCOUNT_KEY = 'cfp_live_test'
ACCOUNT_ENDPOINT = 'https://captcha.camoufox.com/v1'


class Browser:
    pass


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch, tmp_path):
    for name in ('PRO_KEY', 'CAPTCHA_URL', 'CAPTCHA_ENDPOINT', 'PRO_API'):
        monkeypatch.delenv(PRODUCT.env_var(name), raising=False)
    monkeypatch.delenv('CAPTCHA_KRAKEN_API_KEY', raising=False)
    monkeypatch.delenv('VLLM_API_KEY', raising=False)
    # Nor a CaptchaKraken sign-in or local server: the client falls back to those.
    monkeypatch.setenv('CAPTCHA_KRAKEN_STATE_DIR', str(tmp_path / 'captchakraken'))
    # No `camoufox login` key on this machine.
    monkeypatch.setattr(pro, 'credential_path', lambda: tmp_path / 'no-credentials.json')
    # The captcha extra is a test prerequisite: a missing one fails.
    require_client(PRODUCT)


@pytest.fixture
def launched(monkeypatch):
    """NewBrowser with the launch itself replaced: the calls it made, in order."""
    calls = []

    def launch(playwright, display, headless, from_options, persistent_context, *rest):
        calls.append(persistent_context)
        return Browser(), 'lin'

    async def new_browser(*args):
        return launch(*args)

    monkeypatch.setattr(sync_api, '_launch', launch)
    monkeypatch.setattr(async_api, '_new_browser', new_browser)
    monkeypatch.setattr(sync_api, 'start_virtual_display', lambda headless, *a: (None, headless))
    monkeypatch.setattr(async_api, 'start_virtual_display', lambda headless, *a: (None, headless))
    return calls


def planner(solver):
    return solver._solver.planner


def test_true_without_a_key_lists_an_account_first_before_anything_is_downloaded(monkeypatch, tmp_path):
    def download(*_args, **_kwargs):
        raise AssertionError('downloaded')

    monkeypatch.setattr(multiversion, 'get_active_path', lambda: None)
    monkeypatch.setattr(utils, 'INSTALL_DIR', tmp_path / 'empty')
    monkeypatch.setattr(pkgman, 'camoufox_path', download)
    monkeypatch.setattr(pkgman.CamoufoxFetcher, 'install', download)
    monkeypatch.setattr(utils, 'ensure_browser_profile_dir', download)
    with pytest.raises(CaptchaKeyMissing) as raised:
        utils.launch_options(headless=True, captcha=True)
    message = str(raised.value)
    account, self_hosted = message.index('https://camoufox.com/early-access/'), message.index('captchakraken server')
    assert account < self_hosted
    assert raised.value.url == 'https://camoufox.com/early-access/'


def test_the_option_never_reaches_playwright(tmp_path, monkeypatch):
    directory = tmp_path / 'build'
    directory.mkdir()
    (directory / 'properties.json').write_text(json.dumps([{'property': 'screen.width', 'type': 'uint'}]))
    monkeypatch.setattr(utils, 'resolve_verstr', lambda *a: '152.0.4-beta.31')
    monkeypatch.setattr(utils, 'get_env_vars', lambda config, *a, **k: {})
    options = utils.launch_options(
        executable_path=directory / 'camoufox-bin', os='windows', headless=True, i_know_what_im_doing=True,
        captcha=CK_KEY,
    )
    assert 'captcha' not in options


def test_no_captcha_is_none(launched):
    assert sync_api.NewBrowser(object(), headless=True).captcha is None


def test_a_captchakraken_key_solves_at_captchakraken(launched):
    from captchakraken import PageSolver

    browser = sync_api.NewBrowser(object(), headless=True, captcha=CK_KEY)
    assert isinstance(browser.captcha, PageSolver)
    assert (planner(browser.captcha).base_url, planner(browser.captcha).api_key) == (CAPTCHAKRAKEN_ENDPOINT, CK_KEY)


def test_an_account_key_solves_at_the_accounts_endpoint(launched):
    browser = sync_api.NewBrowser(object(), headless=True, captcha=ACCOUNT_KEY)
    assert (planner(browser.captcha).base_url, planner(browser.captcha).api_key) == (ACCOUNT_ENDPOINT, ACCOUNT_KEY)


def test_true_reads_the_account_key_from_the_environment(launched, monkeypatch):
    monkeypatch.setenv('CAMOUFOX_PRO_KEY', ACCOUNT_KEY)
    browser = sync_api.NewBrowser(object(), headless=True, captcha=True)
    assert (planner(browser.captcha).base_url, planner(browser.captcha).api_key) == (ACCOUNT_ENDPOINT, ACCOUNT_KEY)


def test_one_key_serves_every_service(monkeypatch):
    """The launch's pro_key, then the key `camoufox login` stored, solve too."""
    monkeypatch.setenv('CAMOUFOX_PRO_KEY', 'cfp_live_env')
    assert utils.captcha_of(True, pro_key=ACCOUNT_KEY).key == ACCOUNT_KEY
    monkeypatch.delenv('CAMOUFOX_PRO_KEY')
    monkeypatch.setattr(pro, 'stored_key', lambda: 'cfp_live_stored')
    captcha = utils.captcha_of(True)
    assert (captcha.endpoint, captcha.key) == (ACCOUNT_ENDPOINT, 'cfp_live_stored')


def test_a_self_hosted_server_gets_no_camoufox_key(launched, monkeypatch):
    monkeypatch.setenv('CAMOUFOX_PRO_KEY', ACCOUNT_KEY)
    assert utils.captcha_of('http://localhost:8000/v1').key is None
    browser = sync_api.NewBrowser(object(), headless=True, captcha='http://localhost:8000/v1')
    assert planner(browser.captcha).base_url == 'http://localhost:8000/v1'
    assert planner(browser.captcha).api_key != ACCOUNT_KEY


def test_a_persistent_context_gets_one_too(launched):
    context = sync_api.NewBrowser(object(), headless=True, persistent_context=True, captcha=CK_KEY)
    assert launched == [True]
    assert planner(context.captcha).base_url == CAPTCHAKRAKEN_ENDPOINT


def test_a_bad_option_fails_before_the_launch(launched):
    with pytest.raises(CaptchaKeyMissing):
        sync_api.NewBrowser(object(), headless=True, captcha=True)
    assert launched == []


def test_the_async_api_gets_none_without_captcha(launched):
    assert asyncio.run(async_api.AsyncNewBrowser(object(), headless=True)).captcha is None


def test_the_async_api_gets_the_async_solver(launched, monkeypatch):
    import captchakraken

    class AsyncPageSolver:
        def __init__(self, config, solver):
            self._solver = solver

    monkeypatch.setattr(captchakraken, 'AsyncPageSolver', AsyncPageSolver, raising=False)
    browser = asyncio.run(async_api.AsyncNewBrowser(object(), headless=True, captcha=CK_KEY))
    assert isinstance(browser.captcha, AsyncPageSolver)
    assert planner(browser.captcha).base_url == CAPTCHAKRAKEN_ENDPOINT


def test_the_async_api_refuses_a_client_without_an_async_solver_before_the_launch(launched, monkeypatch):
    import captchakraken

    monkeypatch.delattr(captchakraken, 'AsyncPageSolver', raising=False)
    with pytest.raises(CaptchaKrakenMissing, match='AsyncPageSolver'):
        asyncio.run(async_api.AsyncNewBrowser(object(), headless=True, captcha=CK_KEY))
    assert launched == []


def test_the_exceptions_are_camoufoxs():
    from camoufox import exceptions

    assert {'ProNotLaunched', 'CaptchaKeyMissing', 'CaptchaKrakenMissing'} <= set(vars(exceptions))
