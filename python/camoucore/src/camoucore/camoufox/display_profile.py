"""
The display's ICC colour profile, which a page reads through every ICC-tagged
image it decodes.

Firefox colour-manages tagged images (gfx.color_management.mode 2, the default
on every OS) from the image's profile to the display's: the OS profile
(GetICMProfileW on Windows, the X root window's _ICC_PROFILE on Linux), or the
file named by gfx.color_management.display_profile, which every platform reads
first (gfxWindowsPlatform.cpp GetPlatformCMSOutputProfileData_Impl,
gfxPlatformGtk.cpp GetPlatformCMSOutputProfileData). A page draws a tagged PNG
onto a canvas and reads the pixels back, so a wide-gamut panel's profile and
qcms's built-in sRGB (a Linux host with no _ICC_PROFILE: Xvfb, headless) decode
sRGB red differently. Untagged images and CSS colours are not converted (mode
2), and matchMedia('(color-gamut)') is "srgb" on every OS whatever the profile
(widget/Screen.cpp GetColorGamut), so the profile is tied to no other claimed
value but the display itself.

`display_profile=` sets it: ICC bytes or a path, e.g. one recorded with
GetICMProfileW on a real machine (scripts/reduce-icc-profile.py keeps only the
tags qcms reads). Without one the browser reads the real display's profile, as
stock does. It is a stock Firefox pref, so any release honours it.
"""

import hashlib
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Union

DISPLAY_PROFILE_PREF = 'gfx.color_management.display_profile'

DisplayProfileOption = Union[None, bool, bytes, str, Path]


def check_icc(data: bytes) -> bytes:
    """`data` if it is an ICC profile (its declared size fits, 'acsp' at 36), else ValueError.

    A file that is not one would leave Firefox on its built-in sRGB without a
    word, so the launcher refuses it instead.
    """
    if len(data) < 132 or data[36:40] != b'acsp' or int.from_bytes(data[:4], 'big') > len(data):
        raise ValueError('display_profile is not an ICC profile')
    return data


def _cache_dirs() -> List[Path]:
    """Where profiles are written: beside the installed browsers, else the temp dir."""
    from .pkgman import INSTALL_DIR

    return [Path(INSTALL_DIR) / 'display-profiles', Path(tempfile.gettempdir()) / 'camoufox-display-profiles']


def _write(data: bytes) -> str:
    """The profile's path in the cache (content-addressed, written once)."""
    name = hashlib.sha256(data).hexdigest()[:24] + '.icc'
    for base in _cache_dirs():
        path = base / name
        try:
            if not path.exists() or path.read_bytes() != data:
                base.mkdir(parents=True, exist_ok=True)
                tmp = base / f'.{name}.{os.getpid()}'
                tmp.write_bytes(data)
                os.replace(tmp, path)
            return str(path)
        except OSError:
            continue
    raise OSError('no writable directory for the display profile')


def apply_display_profile(
    prefs: Dict[str, Any],
    user_pref_keys: Set[str],
    option: DisplayProfileOption,
) -> Optional[str]:
    """Point gfx.color_management.display_profile at the caller's display profile.

    `option`: ICC bytes or a path. None, True or False: nothing is set and the
    browser reads the display's own, as stock does. A caller's own pref wins.
    Returns the path set.
    """
    if DISPLAY_PROFILE_PREF in user_pref_keys or option is None or isinstance(option, bool):
        return None
    if isinstance(option, (bytes, bytearray)):
        data = bytes(option)
    else:
        data = Path(option).expanduser().read_bytes()
    path = _write(check_icc(data))
    prefs[DISPLAY_PROFILE_PREF] = path
    return path
