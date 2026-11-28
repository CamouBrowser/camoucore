"""The wrapper contract: RELEASING.md, "The wrapper packages", says what the
browser repository's `camoufox` package must contain so that `import camoufox`
and `camoufox` on the command line keep meaning what they meant before the
launcher moved into camoucore. This builds that wrapper exactly as documented,
in a temporary directory, and checks it.

The twin is tests/camouwolf/test_wrapper_contract.py.
"""

import json
import os
import pkgutil
import re
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

import camoucore.camoufox as impl

LAUNCHER = 'camoufox'
PACKAGE = Path(__file__).resolve().parents[2]
RELEASING = PACKAGE.parents[1] / 'RELEASING.md'

PIN = {
    'tag': 'v150.0.2-beta.25',
    'repo': 'wrapper/test',
    'repo_name': 'wrapper',
    'version': '150.0.2',
    'build': 'beta.25',
}


def documented_modules() -> list:
    """The launcher's line in RELEASING.md's list of submodules to alias."""
    match = re.search(rf'^\s*{LAUNCHER}: (.+)$', RELEASING.read_text(), re.M)
    assert match, f'RELEASING.md lists no submodules for {LAUNCHER}'
    return match.group(1).split()


def public_modules() -> list:
    """Every module a user can import: no leading underscore, plus __version__."""
    names = {m.name for m in pkgutil.iter_modules(impl.__path__) if not m.name.startswith('_')}
    return sorted(names | {'__version__'})


def test_releasing_md_lists_every_public_module():
    # A module camoucore adds is one the wrappers must add a stub for: the list
    # the browser repositories copy from has to say so.
    assert documented_modules() == public_modules()


def build_wrapper(root: Path) -> None:
    """The wrapper package, file for file as RELEASING.md describes it."""
    package = root / LAUNCHER
    package.mkdir()
    (package / '__init__.py').write_text(textwrap.dedent(f'''\
        import camoucore.{LAUNCHER} as _impl
        from camoucore.{LAUNCHER} import *  # noqa: F403
        from camoucore.{LAUNCHER} import __all__  # noqa: F401


        def __getattr__(name):
            return getattr(_impl, name)
    '''))
    (package / '__main__.py').write_text(textwrap.dedent(f'''\
        from camoucore.{LAUNCHER}.__main__ import cli

        if __name__ == "__main__":
            cli()
    '''))
    for module in documented_modules():
        (package / f'{module}.py').write_text(textwrap.dedent(f'''\
            import importlib
            import sys

            sys.modules[__name__] = importlib.import_module("camoucore.{LAUNCHER}.{module}")
        '''))
    pin = root / f'{LAUNCHER}_pin'
    pin.mkdir()
    (pin / '__init__.py').write_text('')
    (pin / 'browser-pin.json').write_text(json.dumps(PIN))


@pytest.fixture
def wrapper(tmp_path):
    build_wrapper(tmp_path)
    env = dict(os.environ)
    env['PYTHONPATH'] = os.pathsep.join([str(tmp_path), str(PACKAGE / 'src')])
    return tmp_path, env


CHECK = f'''
import importlib, json, sys
import {LAUNCHER}
import camoucore.{LAUNCHER} as impl

modules = json.loads(sys.argv[1])
for name in modules:
    alias = importlib.import_module("{LAUNCHER}." + name)
    real = importlib.import_module("camoucore.{LAUNCHER}." + name)
    assert alias is real, name
    assert getattr({LAUNCHER}, name) is real, name

from {LAUNCHER}.sync_api import NewBrowser
from {LAUNCHER} import utils
assert NewBrowser is impl.sync_api.NewBrowser
assert utils is impl.utils
assert {LAUNCHER}.__all__ == impl.__all__
assert all(getattr({LAUNCHER}, name) is getattr(impl, name) for name in impl.__all__)
# One copy of each module: nothing was loaded twice under the wrapper's name.
assert not [m for m in sys.modules if m.startswith("{LAUNCHER}.") and sys.modules[m].__name__ == m]

print(impl.browser_pin.pin_file())
print(impl.browser_pin.load_pin().tag)
'''


def test_the_wrapper_is_the_launcher(wrapper):
    root, env = wrapper
    result = subprocess.run(
        [sys.executable, '-c', CHECK, json.dumps(documented_modules())],
        env=env, cwd=root, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    pin_file, tag = result.stdout.split()
    # The wrapper's pin wins over the driver's own.
    assert Path(pin_file) == root / f'{LAUNCHER}_pin' / 'browser-pin.json'
    assert tag == PIN['tag']


def test_python_dash_m_runs_the_cli(wrapper):
    root, env = wrapper
    result = subprocess.run(
        [sys.executable, '-m', LAUNCHER, '--help'], env=env, cwd=root, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert 'fetch' in result.stdout


def test_the_console_script_target_is_the_cli():
    # The wrapper's console script is `camoufox = "camoucore.camoufox.__main__:cli"`.
    from camoucore.camoufox.__main__ import cli

    assert cli.name == 'cli' and callable(cli)
