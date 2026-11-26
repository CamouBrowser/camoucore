"""The captcha option: an account key, a CaptchaKraken key or a server you host,
and a missing one refused with a free account listed first."""

import importlib.util
from pathlib import Path

import pytest

from camoucore import FIREFOX, Product
from camoucore.captcha import (
    CAPTCHAKRAKEN_ENDPOINT,
    Captcha,
    require_client,
    resolve_captcha,
)
from camoucore.exceptions import CaptchaKeyMissing, CaptchaKrakenMissing

FOX = Product(
    'camoufox',
    'Camoufox',
    FIREFOX,
    package=Path('/nonexistent/camoufox'),
    site='https://accounts.example',
    captcha_endpoint='https://captcha.example/v1',
)
ACCOUNT_KEY = 'cfp_live_abc123'
CK_KEY = 'ck_live_def456'


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for variable in (
        'CAMOUFOX_PRO_KEY',
        'CAMOUFOX_CAPTCHA_URL',
        'CAMOUFOX_CAPTCHA_ENDPOINT',
        'CAMOUFOX_PRO_API',
        'CAPTCHA_KRAKEN_API_KEY',
        'CAPTCHA_KRAKEN_CLIENT',
    ):
        monkeypatch.delenv(variable, raising=False)


@pytest.mark.parametrize('option', [None, False])
def test_no_captcha_asked_for(option):
    assert resolve_captcha(FOX, option) is None


def test_an_account_key_solves_at_the_accounts_endpoint():
    assert resolve_captcha(FOX, ACCOUNT_KEY) == Captcha('https://captcha.example/v1', ACCOUNT_KEY, 'account')


def test_the_accounts_endpoint_can_be_moved(monkeypatch):
    monkeypatch.setenv('CAMOUFOX_CAPTCHA_ENDPOINT', 'https://staging.example/v1')
    assert resolve_captcha(FOX, ACCOUNT_KEY).endpoint == 'https://staging.example/v1'


def test_a_captchakraken_key_solves_at_captchakraken():
    assert resolve_captcha(FOX, CK_KEY) == Captcha(CAPTCHAKRAKEN_ENDPOINT, CK_KEY, 'captchakraken')


def test_a_url_is_a_server_you_host():
    assert resolve_captcha(FOX, 'http://localhost:8000/v1/') == Captcha('http://localhost:8000/v1', None, 'self-hosted')


def test_a_server_you_host_can_take_a_key():
    captcha = resolve_captcha(FOX, {'endpoint': 'https://solver.internal/v1', 'key': 'local-secret'})
    assert captcha == Captcha('https://solver.internal/v1', 'local-secret', 'self-hosted')


def test_a_mapping_with_only_a_key_reads_it_like_a_string():
    assert resolve_captcha(FOX, {'key': CK_KEY}).source == 'captchakraken'


@pytest.mark.parametrize(
    'variable, value, source',
    [
        ('CAMOUFOX_PRO_KEY', ACCOUNT_KEY, 'account'),
        ('CAPTCHA_KRAKEN_API_KEY', CK_KEY, 'captchakraken'),
        # The Pro docs tell people to put their account key here for the client.
        ('CAPTCHA_KRAKEN_API_KEY', ACCOUNT_KEY, 'account'),
        ('CAMOUFOX_CAPTCHA_URL', 'http://localhost:8000/v1', 'self-hosted'),
    ],
)
def test_true_reads_the_environment(monkeypatch, variable, value, source):
    monkeypatch.setenv(variable, value)
    assert resolve_captcha(FOX, True).source == source


def test_the_account_key_comes_first(monkeypatch):
    monkeypatch.setenv('CAPTCHA_KRAKEN_API_KEY', CK_KEY)
    monkeypatch.setenv('CAMOUFOX_PRO_KEY', ACCOUNT_KEY)
    assert resolve_captcha(FOX, True).key == ACCOUNT_KEY


@pytest.mark.parametrize('option', [True, {}, {'key': ''}])
def test_no_key_lists_an_account_first_and_hosting_second(option):
    with pytest.raises(CaptchaKeyMissing) as raised:
        resolve_captcha(FOX, option)
    message = str(raised.value)
    account = message.index('1. Make a free Camoufox account at https://accounts.example/early-access/')
    hosted = message.index('2. Host CaptchaKraken yourself')
    assert account < hosted
    assert 'CAMOUFOX_PRO_KEY' in message and 'CAMOUFOX_CAPTCHA_URL' in message
    assert raised.value.url == 'https://accounts.example/early-access/'


def test_an_unknown_key_is_refused_without_echoing_it():
    with pytest.raises(ValueError, match='not a key') as raised:
        resolve_captcha(FOX, 'sk-secret-value')
    assert 'sk-secret-value' not in str(raised.value)


def test_a_bad_variable_is_named(monkeypatch):
    monkeypatch.setenv('CAMOUFOX_CAPTCHA_URL', 'localhost:8000')
    with pytest.raises(ValueError, match='CAMOUFOX_CAPTCHA_URL'):
        resolve_captcha(FOX, True)


@pytest.mark.parametrize('option', [{'url': 'http://x'}, {'endpoint': 'not a url'}, 3])
def test_malformed_options_are_refused(option):
    with pytest.raises((ValueError, TypeError)):
        resolve_captcha(FOX, option)


def test_the_key_stays_out_of_its_repr():
    assert ACCOUNT_KEY not in repr(resolve_captcha(FOX, ACCOUNT_KEY))


def test_a_missing_client_fails_at_launch(monkeypatch):
    real = importlib.util.find_spec
    monkeypatch.setattr(importlib.util, 'find_spec', lambda name, *a: None if name == 'captchakraken' else real(name, *a))
    with pytest.raises(CaptchaKrakenMissing, match=r'pip install "camoufox\[captcha\]"'):
        resolve_captcha(FOX, CK_KEY)


def test_the_page_solver_solves_where_the_option_says():
    require_client(FOX)  # The captcha extra is a test prerequisite: a missing one fails.
    page_solver = resolve_captcha(FOX, 'http://localhost:8123/v1').page_solver(FOX, max_solve_loops=2)
    planner = page_solver._solver.planner
    assert planner.base_url == 'http://localhost:8123/v1'
    assert page_solver.config.max_solve_loops == 2


def test_two_solvers_in_one_process_keep_their_own_endpoints():
    first = resolve_captcha(FOX, CK_KEY).page_solver(FOX)
    second = resolve_captcha(FOX, ACCOUNT_KEY).page_solver(FOX)
    assert (first._solver.planner.base_url, first._solver.planner.api_key) == (CAPTCHAKRAKEN_ENDPOINT, CK_KEY)
    assert (second._solver.planner.base_url, second._solver.planner.api_key) == ('https://captcha.example/v1', ACCOUNT_KEY)


def test_hosted_solves_name_the_launcher(monkeypatch):
    import os

    resolve_captcha(FOX, CK_KEY).page_solver(FOX)
    assert os.environ['CAPTCHA_KRAKEN_CLIENT'] == 'camoufox'
    monkeypatch.setenv('CAPTCHA_KRAKEN_CLIENT', 'my-tool/1.0')
    resolve_captcha(FOX, CK_KEY).page_solver(FOX)
    assert os.environ['CAPTCHA_KRAKEN_CLIENT'] == 'my-tool/1.0'


def test_the_expert_pin_reaches_the_solver():
    from captchakraken import PromptFamily

    # The default model serves no experts, so the client refuses a pin it was handed:
    # without the pass-through the pin would be dropped silently and this would not raise.
    with pytest.raises(ValueError, match="expert 'pixel' was requested"):
        resolve_captcha(FOX, CK_KEY).page_solver(FOX, expert=PromptFamily.PIXEL)


def test_an_async_browser_gets_the_async_solver_or_a_reason():
    import captchakraken

    captcha = resolve_captcha(FOX, CK_KEY)
    if getattr(captchakraken, 'AsyncPageSolver', None) is None:
        with pytest.raises(CaptchaKrakenMissing, match='AsyncPageSolver'):
            captcha.page_solver(FOX, asynchronous=True)
    else:
        solver = captcha.page_solver(FOX, asynchronous=True)
        assert isinstance(solver, captchakraken.AsyncPageSolver)
        assert solver._solver._solver.planner.base_url == CAPTCHAKRAKEN_ENDPOINT
