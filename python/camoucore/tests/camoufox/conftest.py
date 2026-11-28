from pathlib import Path

import pytest

# A snapshot of the browser's properties.json (browser/settings/ in the browser
# repository), taken when a launcher change needs a key the browser added.
SETTINGS = Path(__file__).resolve().parent / 'data'


@pytest.fixture(autouse=True)
def no_host_gpu_probe(monkeypatch):
    """launch_options launches the browser to read the host's GPU when an
    identity claims the host's OS. This suite has no browser, and its results
    must not depend on the machine running it, so the host reads as having no
    WebGL. Tests of the probe's consumers patch it themselves."""
    from camoucore.camoufox import utils

    monkeypatch.setattr(utils, 'host_gpu', lambda *args: None)


@pytest.fixture(autouse=True)
def properties_of_this_checkout(monkeypatch):
    """launch_options reads properties.json from the installed build. This
    suite runs without a browser, so it reads the snapshot in tests/data; the
    integration tests read the released browser's own."""
    from camoucore.camoufox import utils

    load = utils._load_properties
    monkeypatch.setattr(
        utils, '_load_properties', lambda path=None: load(path or SETTINGS / 'camoufox-bin')
    )


@pytest.fixture(autouse=True)
def no_telemetry_or_user_defaults(monkeypatch, tmp_path):
    """Launches in this suite report nothing, and read the packaged defaults
    alone, not the defaults file of whoever runs it. The tests of either set
    their own."""
    monkeypatch.setenv('CAMOUFOX_TELEMETRY', '0')
    monkeypatch.setenv('CAMOUFOX_DEFAULTS', str(tmp_path / 'no-user-defaults.json'))
