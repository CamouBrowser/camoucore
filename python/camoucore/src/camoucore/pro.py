"""
Pro's launch options, ahead of Pro's launch.

Pro is a paid service run alongside the free launchers, and it has not opened
yet. Its options are taken now so that code written for Pro reads the same,
and a value that asks for a Pro feature raises ProNotLaunched, which names the
page where an account is made and the waitlist joined.

A launcher skips this check when it launches a Pro build, and so does a
process whose environment names a Pro API (`<NAME>_PRO_API`), as Pro's own
builds and tests do.
"""

from typing import Any, Dict, Mapping

from .exceptions import ProNotLaunched
from .product import Product

# Each Pro option, with the value that asks for nothing Pro does: no managed
# proxy, and rendering on this machine's GPU, are what every launch does.
PRO_OPTIONS: Dict[str, Any] = {
    'pro_key': None,
    'profile': None,
    'warm_plan': None,
    'managed': False,
    'farm_gpu': False,
}


def early_access_url(product: Product) -> str:
    """Where an account is made and the Pro waitlist joined."""
    return f'{product.site}/early-access/'


def pro_api_set(product: Product) -> bool:
    """Whether this process was pointed at a Pro API, as a Pro build's own tests are."""
    return bool((product.getenv('PRO_API') or '').strip())


def check_pro_options(product: Product, options: Mapping[str, Any]) -> None:
    """Raise ProNotLaunched for the first Pro option that asks for a Pro feature."""
    if pro_api_set(product):
        return
    for name, inert in PRO_OPTIONS.items():
        value = options.get(name)
        if value is not None and value is not inert:
            raise ProNotLaunched(name, product.title, early_access_url(product))
