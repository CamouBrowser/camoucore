"""Pro's options, before Pro launches: taken, and refused with the page where
an account is made."""

import pytest
from click.testing import CliRunner

from camoucore.pro import PRO_OPTIONS, early_access_url

from camouwolf import utils
from camouwolf.__main__ import cli
from camouwolf.exceptions import ProNotLaunched
from camouwolf.product import PRODUCT

EARLY_ACCESS_URL = 'https://camoufox.com/early-access/'

ASKS = {
    'pro_key': 'cfp_live_x',
    'profile': 'shop-account-1',
    'warm_plan': 'none',
    'managed': True,
    'farm_gpu': True,
}


@pytest.fixture(autouse=True)
def no_pro_api(monkeypatch):
    monkeypatch.delenv('CAMOUWOLF_PRO_API', raising=False)


@pytest.fixture
def no_download(monkeypatch):
    """Resolving the browser is where a launch downloads it."""

    def download(*_args, **_kwargs):
        raise AssertionError('downloaded')

    monkeypatch.setattr(utils, 'launch_path', download)
    monkeypatch.setattr(utils, 'installed_verstr', download)


def test_the_account_page_is_camoufoxs():
    assert early_access_url(PRODUCT) == EARLY_ACCESS_URL


@pytest.mark.parametrize('option', sorted(ASKS))
def test_a_pro_option_points_at_early_access_before_anything_is_downloaded(option, no_download):
    with pytest.raises(ProNotLaunched, match=option) as raised:
        utils.launch_options(headless=True, **{option: ASKS[option]})
    assert EARLY_ACCESS_URL in str(raised.value)
    assert raised.value.option == option


def test_every_pro_option_is_covered():
    assert set(ASKS) == set(PRO_OPTIONS)


def test_values_that_ask_for_nothing_pro_launch(options):
    launch = options(os='linux', managed=False, farm_gpu=False, i_know_what_im_doing=True)
    assert not set(PRO_OPTIONS) & set(launch)


def test_login_says_where_to_make_an_account():
    result = CliRunner().invoke(cli, ['login'])
    assert result.exit_code == 1
    assert EARLY_ACCESS_URL in result.output
