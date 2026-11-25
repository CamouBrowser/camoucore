"""
A launcher's defaults file: the values every launch starts from, in one JSON
file people can read and edit.

Each launcher ships `<name>.defaults.json` at its repository root and inside
its package. Every option in it is documented in place:

    {
      "telemetry": {
        "default": true,
        "about": "What the option does, in a sentence or two.",
        "examples": [false]
      }
    }

A user changes a default without touching the installed package, in a file of
the same shape (or the short form `{"telemetry": false}`) at the path
`user_defaults_path()` returns, or at the path in `<NAME>_DEFAULTS`. A value a
caller passes to the launch wins over both.
"""

import json
from pathlib import Path
from typing import Any, Dict, Mapping, Optional

from platformdirs import user_config_dir

from .product import Product


def user_defaults_path(product: Product) -> Path:
    """Where a user's own defaults live: `<NAME>_DEFAULTS`, or the user config directory."""
    override = product.getenv('DEFAULTS')
    if override:
        return Path(override).expanduser()
    return Path(user_config_dir(product.name)) / 'defaults.json'


def _read(path: Path) -> Dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        raise ValueError(f'{path} is not valid JSON: {e}') from None
    if not isinstance(data, dict):
        raise ValueError(f'{path} must hold a JSON object of option names')
    return data


def _documented_defaults(path: Path) -> Dict[str, Any]:
    out = {}
    for name, entry in _read(path).items():
        if name.startswith('$') or name.startswith('_'):
            continue
        if not isinstance(entry, dict) or 'default' not in entry or not entry.get('about'):
            raise ValueError(f'{path}: "{name}" needs a "default" and an "about"')
        out[name] = entry['default']
    return out


def _user_values(path: Path, known: Mapping[str, Any]) -> Dict[str, Any]:
    out = {}
    for name, entry in _read(path).items():
        if name.startswith('$') or name.startswith('_'):
            continue
        if name not in known:
            raise ValueError(f'{path}: "{name}" is not an option of the defaults file ({", ".join(known)})')
        value = entry['default'] if isinstance(entry, dict) and 'default' in entry else entry
        expected = known[name]
        if expected is not None and value is not None and type(value) is not type(expected):
            raise ValueError(
                f'{path}: "{name}" is {type(value).__name__}, but its default is {type(expected).__name__}'
            )
        out[name] = value
    return out


def load_defaults(product: Product, packaged: Path, user_file: Optional[Path] = None) -> Dict[str, Any]:
    """
    The launch defaults: the packaged file's, overlaid with the user's own file
    when it exists. An unknown option or a value of the wrong type in the
    user's file raises ValueError, so a typo never silently does nothing.
    """
    defaults = _documented_defaults(packaged)
    path = user_file or user_defaults_path(product)
    if path.is_file():
        defaults.update(_user_values(path, defaults))
    return defaults


def apply_defaults(defaults: Mapping[str, Any], options: Mapping[str, Any]) -> Dict[str, Any]:
    """`options` with each one the caller left unset (None or absent) taken from `defaults`."""
    out = dict(options)
    for name, value in defaults.items():
        if out.get(name) is None:
            out[name] = value
    return out


def write_user_defaults(product: Product, packaged: Path) -> Path:
    """Copy the packaged defaults file to the user's path, unless one is there
    already, and return that path (for a `<name> defaults` command)."""
    path = user_defaults_path(product)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(packaged.read_text(encoding='utf-8'), encoding='utf-8')
    return path
