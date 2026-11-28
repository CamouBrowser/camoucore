import os
from pathlib import Path

import pytest

from camoucore import CHROMIUM, Product

TESTS_DIR = Path(__file__).resolve().parent

# Tests that start another interpreter test this checkout too, and can import
# PRODUCT from here.
os.environ['PYTHONPATH'] = os.pathsep.join(
    filter(None, (str(TESTS_DIR.parents[1] / 'src'), str(TESTS_DIR), os.environ.get('PYTHONPATH')))
)

# A launcher for the tests to be: camoucore code never names a real one.
PRODUCT = Product('camoutest', 'Camoutest', CHROMIUM, package=TESTS_DIR / 'launcher')


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    """No test reaches the real desktop or reads the runner's overrides."""
    for name in ('DISPLAY', 'WAYLAND_DISPLAY'):
        monkeypatch.delenv(name, raising=False)
    for key in ('VIRTUAL_DISPLAY_SIZE', 'VIRTUAL_DISPLAY_COMPOSITE'):
        monkeypatch.delenv(PRODUCT.env_var(key), raising=False)
