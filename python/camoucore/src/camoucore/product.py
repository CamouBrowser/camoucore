"""
What a launcher built on camoucore is: its name, and the engine it drives.

Nothing in camoucore names a launcher. A module that needs a launcher's name
(its environment variables, its CLI in a message) takes its Product, so
camoufox and camouwolf can both be imported in one process.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

from platformdirs import user_cache_dir

from ._warnings import register_internal


@dataclass(frozen=True)
class Engine:
    name: Literal['firefox', 'chromium']
    # Xvfb root geometry for headless="virtual". Firefox reports the claimed
    # screen and window from its patches, so its root can be 1x1. Chromium's
    # window size is the window's own (--window-size), so its root has to hold
    # the largest window an identity can claim.
    virtual_screen: str


FIREFOX = Engine('firefox', virtual_screen='1x1x24')
CHROMIUM = Engine('chromium', virtual_screen='3840x2160x24')


@dataclass(frozen=True)
class Product:
    # Distribution, CLI, cache and environment-variable name: 'camoufox'.
    name: str
    # How messages name it: 'Camoufox'.
    title: str
    engine: Engine
    # The launcher's package directory. Warnings raised from inside it point at
    # the user's call instead.
    package: Path
    # Where accounts are made, with no trailing slash: 'https://example.com'.
    # One account, and one key, serves every service the launcher reaches.
    site: str

    def __post_init__(self) -> None:
        register_internal(self.package)

    @property
    def cache_dir(self) -> Path:
        return Path(user_cache_dir(self.name))

    def env_var(self, key: str) -> str:
        return f'{self.name.upper()}_{key}'

    def getenv(self, key: str) -> Optional[str]:
        return os.environ.get(self.env_var(key))
