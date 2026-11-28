"""What camoucore needs to know about this launcher."""

from pathlib import Path

from camoucore import FIREFOX, Product

PRODUCT = Product(
    'camoufox',
    'Camoufox',
    FIREFOX,
    package=Path(__file__).parent,
    site='https://camoufox.com',
)
