"""
Captcha solving with CaptchaKraken: the `captcha` launch option.

The option names where solves go and with which key, in one of three ways:

- an account key (`cfp_live_...`), the same key every service of the
  launcher's account takes, which solves at the product's captcha endpoint;
- a CaptchaKraken key (`ck_live_...`), which solves at CaptchaKraken's own API;
- the URL of a CaptchaKraken server you host (`http://localhost:8000/v1`).

`captcha=True` reads the same three from the environment. With none of them
set it raises CaptchaKeyMissing, which lists a free account first and hosting
the solver yourself second. The client itself is an optional dependency, so
asking for captcha without it installed raises CaptchaKrakenMissing at launch
rather than at the first solve.
"""

import importlib.util
import os
from dataclasses import dataclass
from typing import Any, Literal, Mapping, Optional, Union
from urllib.parse import urlsplit

from .exceptions import CaptchaKeyMissing, CaptchaKrakenMissing
from .pro import early_access_url
from .product import Product

ACCOUNT_KEY_PREFIX = 'cfp_live_'
CAPTCHAKRAKEN_KEY_PREFIX = 'ck_live_'
CAPTCHAKRAKEN_ENDPOINT = 'https://api.captchakraken.com/v1'
# The CaptchaKraken client's own variable for its key.
CAPTCHAKRAKEN_KEY_ENV = 'CAPTCHA_KRAKEN_API_KEY'
# The CaptchaKraken client reads which client sent a hosted solve from here.
CAPTCHAKRAKEN_CLIENT_ENV = 'CAPTCHA_KRAKEN_CLIENT'

CaptchaOption = Union[None, bool, str, Mapping[str, Optional[str]]]
Source = Literal['account', 'captchakraken', 'self-hosted']


@dataclass(frozen=True)
class Captcha:
    """Where solves go, and the key they carry (None for a server that wants none)."""

    endpoint: str
    key: Optional[str]
    source: Source

    def __repr__(self) -> str:
        # The key stays out of logs and tracebacks.
        return f'Captcha(endpoint={self.endpoint!r}, source={self.source!r})'

    def page_solver(self, product: Product, *, asynchronous: bool = False, **config: Any) -> Any:
        """
        A captchakraken PageSolver that solves at this endpoint with this key,
        or with `asynchronous` an AsyncPageSolver, for async API pages.
        `config` becomes its PageSolverConfig (max_solve_loops, speed, ...).
        """
        require_client(product)
        import captchakraken
        from captchakraken import CaptchaSolver, PageSolver, PageSolverConfig
        from captchakraken.planner import ActionPlanner

        driver = PageSolver
        if asynchronous:
            driver = getattr(captchakraken, 'AsyncPageSolver', None)
            if driver is None:
                raise CaptchaKrakenMissing(
                    'captcha on an async browser needs a captchakraken release with AsyncPageSolver '
                    '(newer than 5.2.1): pip install -U captchakraken.'
                )

        # The hosted API counts solves per client; a caller's own value stays.
        os.environ.setdefault(CAPTCHAKRAKEN_CLIENT_ENV, product.name)
        settings = PageSolverConfig(**config)
        solver = CaptchaSolver(api_key=self.key)
        # CaptchaSolver takes no endpoint, and the process environment would set
        # one for every solver at once: this one gets its own planner. It carries
        # the config's expert, which PageSolver hands only to a solver it makes.
        solver.planner = ActionPlanner(base_url=self.endpoint, api_key=self.key, expert=settings.expert)
        return driver(config=settings, solver=solver)


def require_client(product: Product) -> None:
    if importlib.util.find_spec('captchakraken') is None:
        raise CaptchaKrakenMissing(
            f'captcha needs the CaptchaKraken client: pip install "{product.name}[captcha]".'
        )


def resolve_captcha(product: Product, option: CaptchaOption) -> Optional[Captcha]:
    """
    The solver the `captcha` option asks for, or None when it asks for none.
    Raises before anything launches when the option cannot be used.
    """
    if option is None or option is False:
        return None
    if option is True:
        captcha = _from_environment(product)
    elif isinstance(option, str):
        captcha = _from_string(product, option.strip(), 'captcha')
    elif isinstance(option, Mapping):
        captcha = _from_mapping(product, option)
    else:
        raise TypeError(
            f'captcha takes True, a key, a server URL, or {{"endpoint", "key"}}; got {type(option).__name__}.'
        )
    require_client(product)
    return captcha


def _is_url(value: str) -> bool:
    parts = urlsplit(value)
    return parts.scheme in ('http', 'https') and bool(parts.netloc)


def _account_endpoint(product: Product) -> str:
    return (product.getenv('CAPTCHA_ENDPOINT') or '').strip() or product.captcha_endpoint


def _from_key(product: Product, key: str, named: str) -> Captcha:
    if key.startswith(ACCOUNT_KEY_PREFIX):
        return Captcha(_account_endpoint(product), key, 'account')
    if key.startswith(CAPTCHAKRAKEN_KEY_PREFIX):
        return Captcha(CAPTCHAKRAKEN_ENDPOINT, key, 'captchakraken')
    # The value is never echoed: it may be a key with a typo.
    raise ValueError(
        f'{named} is not a key this launcher knows: it takes a {product.title} account key '
        f'({ACCOUNT_KEY_PREFIX}...), a CaptchaKraken key ({CAPTCHAKRAKEN_KEY_PREFIX}...), or the URL '
        'of a CaptchaKraken server you host (http://...).'
    )


def _from_string(product: Product, value: str, named: str) -> Captcha:
    if _is_url(value):
        return Captcha(value.rstrip('/'), None, 'self-hosted')
    return _from_key(product, value, named)


def _from_mapping(product: Product, option: Mapping[str, Optional[str]]) -> Captcha:
    unknown = set(option) - {'endpoint', 'key'}
    if unknown:
        raise ValueError(f'captcha takes "endpoint" and "key"; it does not take {", ".join(sorted(unknown))}.')
    endpoint = (option.get('endpoint') or '').strip()
    key = (option.get('key') or '').strip() or None
    if endpoint:
        if not _is_url(endpoint):
            raise ValueError(f'captcha["endpoint"] must be an http(s) URL; got {endpoint!r}.')
        source: Source = 'self-hosted'
        if key and key.startswith(ACCOUNT_KEY_PREFIX):
            source = 'account'
        elif key and key.startswith(CAPTCHAKRAKEN_KEY_PREFIX):
            source = 'captchakraken'
        return Captcha(endpoint.rstrip('/'), key, source)
    if key:
        return _from_key(product, key, 'captcha["key"]')
    raise _missing(product)


def _from_environment(product: Product) -> Captcha:
    for variable in (product.env_var('PRO_KEY'), CAPTCHAKRAKEN_KEY_ENV, product.env_var('CAPTCHA_URL')):
        value = (os.environ.get(variable) or '').strip()
        if value:
            return _from_string(product, value, variable)
    raise _missing(product)


def _missing(product: Product) -> CaptchaKeyMissing:
    url = early_access_url(product)
    return CaptchaKeyMissing(
        'Captcha solving needs a key or a server, and none was given. Either:\n'
        f'  1. Make a free {product.title} account at {url} (it comes with 10,000 free captcha '
        f'credits), then pass its key: captcha="{ACCOUNT_KEY_PREFIX}...", or set '
        f'{product.env_var("PRO_KEY")}. The same key works for every {product.title} service.\n'
        '  2. Host CaptchaKraken yourself (pip install "captchakraken[serve]", then '
        '`captchakraken server start`) and pass its URL: captcha="http://localhost:8000/v1", or set '
        f'{product.env_var("CAPTCHA_URL")}.\n'
        f'A CaptchaKraken key ({CAPTCHAKRAKEN_KEY_PREFIX}...) works too, passed the same way or set as '
        f'{CAPTCHAKRAKEN_KEY_ENV}.',
        url,
    )
