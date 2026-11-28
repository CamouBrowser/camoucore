"""Pro's launch options before Pro opens: taken, and refused with the page
where an account is made and the waitlist joined."""

from pathlib import Path

import pytest

from camoucore import CHROMIUM, FIREFOX, Product
from camoucore.exceptions import ProNotLaunched
from camoucore.pro import PRO_OPTIONS, check_pro_options, early_access_url

FOX = Product(
    'camoufox', 'Camoufox', FIREFOX, package=Path('/nonexistent/camoufox'),
    site='https://accounts.example',
)
WOLF = Product(
    'camouwolf', 'Camouwolf', CHROMIUM, package=Path('/nonexistent/camouwolf'),
    site='https://accounts.example',
)
ASKS = {
    'pro_key': 'cfp_live_x',
    'profile': 'shop-account-1',
    'warm_plan': 'none',
    'managed': True,
    'farm_gpu': True,
}


@pytest.fixture(autouse=True)
def no_pro_api(monkeypatch):
    for product in (FOX, WOLF):
        monkeypatch.delenv(product.env_var('PRO_API'), raising=False)


def test_every_pro_option_is_covered():
    assert set(ASKS) == set(PRO_OPTIONS)


@pytest.mark.parametrize('option', sorted(ASKS))
@pytest.mark.parametrize('product', [FOX, WOLF], ids=lambda p: p.name)
def test_a_pro_option_points_at_the_waitlist(product, option):
    with pytest.raises(ProNotLaunched, match=option) as raised:
        check_pro_options(product, {option: ASKS[option]})
    assert 'https://accounts.example/early-access/' in str(raised.value)
    assert f'{product.title} Pro' in str(raised.value)
    assert raised.value.option == option
    assert raised.value.url == early_access_url(product)


def test_values_that_ask_for_nothing_pro_pass():
    check_pro_options(FOX, dict(PRO_OPTIONS))
    check_pro_options(FOX, {})


def test_a_pro_api_in_the_environment_opens_the_options(monkeypatch):
    monkeypatch.setenv('CAMOUFOX_PRO_API', 'https://api.dev.example')
    check_pro_options(FOX, ASKS)
    # Only for the launcher it names.
    with pytest.raises(ProNotLaunched):
        check_pro_options(WOLF, ASKS)
