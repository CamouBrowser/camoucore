"""The captcha option: checked before the launch, and the launched browser's
`.captcha` solver after it."""

import asyncio

import pytest

from camoucore.captcha import CAPTCHAKRAKEN_ENDPOINT, require_client

from camouwolf import async_api, sync_api, utils
from camouwolf.exceptions import CaptchaKeyMissing, CaptchaKrakenMissing
from camouwolf.product import PRODUCT

CK_KEY = 'ck_live_test'
ACCOUNT_KEY = 'cfp_live_test'


class Browser:
    def new_context(self, **kwargs):
        pass


class Chromium:
    def __init__(self):
        self.launched = []

    def launch(self, **kwargs):
        self.launched.append(kwargs)
        return Browser()

    def launch_persistent_context(self, **kwargs):
        self.launched.append(kwargs)
        return Browser()


class AsyncChromium(Chromium):
    async def launch(self, **kwargs):
        return super().launch(**kwargs)


class Playwright:
    def __init__(self, chromium):
        self.chromium = chromium


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in ('PRO_KEY', 'CAPTCHA_URL', 'CAPTCHA_ENDPOINT', 'PRO_API'):
        monkeypatch.delenv(PRODUCT.env_var(name), raising=False)
    monkeypatch.delenv('CAPTCHA_KRAKEN_API_KEY', raising=False)
    # The captcha extra is a test prerequisite: a missing one fails.
    require_client(PRODUCT)


def planner(solver):
    return solver._solver.planner


def test_true_without_a_key_lists_an_account_first_before_anything_is_downloaded(monkeypatch):
    def download(*_args, **_kwargs):
        raise AssertionError('downloaded')

    monkeypatch.setattr(utils, 'launch_path', download)
    monkeypatch.setattr(utils, 'installed_verstr', download)
    with pytest.raises(CaptchaKeyMissing) as raised:
        utils.launch_options(headless=True, captcha=True)
    message = str(raised.value)
    account, self_hosted = message.index('https://camoufox.com/early-access/'), message.index('captchakraken server')
    assert account < self_hosted
    assert raised.value.url == 'https://camoufox.com/early-access/'


def test_the_option_never_reaches_playwright(options):
    launch = options(os='linux', captcha=CK_KEY, i_know_what_im_doing=True)
    assert 'captcha' not in launch


def test_no_captcha_is_none(options):
    chromium = Chromium()
    browser = sync_api.NewBrowser(Playwright(chromium), from_options=options(os='linux'))
    assert browser.captcha is None


def test_a_captchakraken_key_solves_at_captchakraken(options):
    from captchakraken import PageSolver

    browser = sync_api.NewBrowser(Playwright(Chromium()), from_options=options(os='linux'), captcha=CK_KEY)
    assert isinstance(browser.captcha, PageSolver)
    assert (planner(browser.captcha).base_url, planner(browser.captcha).api_key) == (CAPTCHAKRAKEN_ENDPOINT, CK_KEY)


def test_an_account_key_solves_at_the_accounts_endpoint(options):
    browser = sync_api.NewBrowser(Playwright(Chromium()), from_options=options(os='linux'), captcha=ACCOUNT_KEY)
    assert planner(browser.captcha).base_url == 'https://captcha.camoufox.com/v1'


def test_a_persistent_context_gets_one_too(options):
    context = sync_api.NewBrowser(
        Playwright(Chromium()), from_options=options(os='linux'), persistent_context=True, captcha=CK_KEY
    )
    assert planner(context.captcha).base_url == CAPTCHAKRAKEN_ENDPOINT


def test_a_bad_option_fails_before_the_launch(options):
    chromium = Chromium()
    with pytest.raises(CaptchaKeyMissing):
        sync_api.NewBrowser(Playwright(chromium), from_options=options(os='linux'), captcha=True)
    assert chromium.launched == []


def test_the_async_api_gets_none_without_captcha(options):
    browser = asyncio.run(async_api.AsyncNewBrowser(Playwright(AsyncChromium()), from_options=options(os='linux')))
    assert browser.captcha is None


def test_the_async_api_gets_the_async_solver(options, monkeypatch):
    import captchakraken

    class AsyncPageSolver:
        def __init__(self, config, solver):
            self._solver = solver

    monkeypatch.setattr(captchakraken, 'AsyncPageSolver', AsyncPageSolver, raising=False)
    browser = asyncio.run(
        async_api.AsyncNewBrowser(Playwright(AsyncChromium()), from_options=options(os='linux'), captcha=CK_KEY)
    )
    assert isinstance(browser.captcha, AsyncPageSolver)
    assert planner(browser.captcha).base_url == CAPTCHAKRAKEN_ENDPOINT


def test_the_async_api_refuses_a_client_without_an_async_solver_before_the_launch(options, monkeypatch):
    import captchakraken

    monkeypatch.delattr(captchakraken, 'AsyncPageSolver', raising=False)
    chromium = AsyncChromium()
    with pytest.raises(CaptchaKrakenMissing, match='AsyncPageSolver'):
        asyncio.run(async_api.AsyncNewBrowser(Playwright(chromium), from_options=options(os='linux'), captcha=CK_KEY))
    assert chromium.launched == []
