"""A context gets its identity from Target.setBrowserContextIdentity before its
first renderer, never from Playwright's emulation overrides.

Emulation answers in a page and nowhere else: the context's workers, request
headers, client hints, WebRTC and GPU process still answer as the launch, and a
page that compares its window with a worker reads two machines. Only an identity
the browser holds for the context reaches them all.

This was the browser repository's `context-identity-is-the-browsers` rule; it
checks driver source, so it lives with the drivers. Both Camouwolf launchers
are held to it.
"""

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
FORBIDDEN = re.compile(r'Emulation\.set(UserAgentOverride|TimezoneOverride|LocaleOverride)')
SOURCES = [
    *(REPO / 'python' / 'camouwolf' / 'src').rglob('*.py'),
    *(REPO / 'typescript' / 'camouwolf' / 'src').rglob('*.ts'),
]


def test_the_sources_are_there():
    # An empty glob would pass the check below vacuously.
    assert any(p.suffix == '.py' for p in SOURCES)
    assert any(p.suffix == '.ts' for p in SOURCES)


@pytest.mark.parametrize('path', SOURCES, ids=lambda p: str(p.relative_to(REPO)))
def test_no_emulation_identity_override(path):
    assert not FORBIDDEN.search(path.read_text(encoding='utf-8'))
