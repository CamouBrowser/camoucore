"""
Passthrough: launch the browser as this machine's own, with no fingerprint injected.

A passthrough launch draws no identity and sends the browser no fingerprint
config, so every value a page reads (user agent, screen, GPU, fonts, timezone,
languages) is the host's, as the same browser build reports it unpatched by
the launcher. Behaviour options (proxy, humanize, block_images, addons, a
virtual display, ...) still apply.

Each launcher decides how to skip its own identity steps; the rules shared by
every launcher live here: which options inject a fingerprint and are refused
with passthrough, and what a passthrough launch should warn about.
"""

from typing import Any, List, Mapping, Optional

from ._warnings import LeakWarning
from .product import Product

# Launch options that set or constrain an injected fingerprint. Passing one with
# passthrough=True is a contradiction, so the launch refuses it rather than
# silently ignoring the caller.
IDENTITY_OPTIONS = (
    'config',
    'os',
    'fingerprint',
    'fingerprint_preset',
    'webgl_config',
    'cpu',
    'screen',
    'window',
    'fonts',
    'custom_fonts_only',
    'locale',
    'geoip',
    'canvas_noise',
    'pin_cpu_cores',
    'allow_os_mismatch',
    'ff_version',
    'chrome_version',
)


def _is_set(value: Any) -> bool:
    return value is not None and value is not False and value != {} and value != []


def passthrough_conflicts(options: Mapping[str, Any]) -> List[str]:
    """The identity options set in `options` (in IDENTITY_OPTIONS order)."""
    return [name for name in IDENTITY_OPTIONS if _is_set(options.get(name))]


def check_passthrough(product: Product, options: Mapping[str, Any]) -> None:
    """
    Raise ValueError naming every identity option set alongside passthrough=True.
    `options` is the launch's keyword arguments; unset ones are None.
    """
    conflicts = passthrough_conflicts(options)
    if conflicts:
        raise ValueError(
            f'passthrough=True launches {product.title} with this machine\'s own fingerprint, so it '
            f'cannot be combined with options that inject one: {", ".join(conflicts)}. '
            'Remove them, or set passthrough=False.'
        )


def warn_passthrough(product: Product, proxy: Optional[Mapping[str, Any]], i_know_what_im_doing: Optional[bool]) -> None:
    """A proxied passthrough launch reports this machine's timezone, languages and
    WebRTC addresses, which can disagree with the proxy's exit."""
    if proxy:
        LeakWarning.warn(
            f'passthrough=True with a proxy: {product.title} reports this machine\'s timezone, '
            'languages and locale, which can disagree with where the proxy exits.',
            i_know_what_im_doing,
        )
