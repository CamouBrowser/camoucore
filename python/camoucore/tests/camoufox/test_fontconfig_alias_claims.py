"""A name the Linux fontconfig rewrites to a font the identity has is a font the page sees.

The browser bundle's fontconfig/linux/fonts.conf carries the aliases a stock
Ubuntu ships (30-metric-aliases.conf and fonts-urw-base35's 61-urw-*.conf).
Firefox honours binding="same" aliases, so with C059 installed a page that
probes "Century" measures C059, on a real Ubuntu and on Camoufox alike. The
identity has to claim that name too: parity-checker's claim-fonts rule caught
"Century" rendering on every Linux identity without being in its font list.

The file is the browser's. CAMOUFOX_BROWSER_DIR names an unpacked browser
release to read it from (CI's integration job sets it to the latest release);
without it, tests/data holds a snapshot of the browser's copy.
"""

import json
import os
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAPSHOT = HERE / 'data' / 'fontconfig-linux-fonts.conf'
FONTS = HERE.parents[1] / 'src' / 'camoucore' / 'camoufox' / 'fonts.json'

GENERICS = {'serif', 'sans-serif', 'sans serif', 'sans', 'monospace', 'mono', 'cursive', 'fantasy',
            'system-ui', 'emoji', 'math'}
# A name a real Ubuntu does not report (gen-fonts-json.py, verify-fonts.py warns).
NOT_REPORTED = {'Noto Sans Canadian Aboriginal Regular'}


def _conf() -> Path:
    browser = os.environ.get('CAMOUFOX_BROWSER_DIR', '').strip()
    if not browser:
        return SNAPSHOT
    conf = Path(browser) / 'fontconfig' / 'linux' / 'fonts.conf'
    assert conf.is_file(), f'CAMOUFOX_BROWSER_DIR={browser} has no fontconfig/linux/fonts.conf'
    return conf


def _same_binding_aliases(conf: Path):
    """(alias, first accepted/preferred family) for each binding="same" alias."""
    out = []
    for alias in ET.parse(conf).getroot().iter('alias'):
        if alias.get('binding') != 'same':
            continue
        name = alias.findtext('family', '').strip()
        for tag in ('prefer', 'accept'):
            el = alias.find(tag)
            if el is not None and el.findtext('family'):
                out.append((name, el.findtext('family').strip()))
                break
    return out


def test_every_rendering_alias_is_reportable():
    conf = _conf()
    aliases = _same_binding_aliases(conf)
    assert aliases, f'{conf} has no binding="same" aliases'
    lin = set(json.loads(FONTS.read_text(encoding='utf-8'))['lin'])
    missing = sorted(
        f'{name} -> {target}'
        for name, target in aliases
        if target in lin and name not in lin and name.lower() not in GENERICS and name not in NOT_REPORTED
    )
    assert not missing, f'rendered through {conf.name} but never claimed: {missing}'
