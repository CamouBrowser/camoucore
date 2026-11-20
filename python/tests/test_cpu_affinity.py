"""Pinning a browser to as many cores as its identity reports."""

import os
import sys

import pytest

from camoucore import cpu_affinity


def test_adjacent_cores_from_a_random_start():
    """Always taking the first cores stacked every browser on one host onto
    cores 0..n-1; adjacent cores keep the SMT layout a real machine has."""
    cores = list(range(16))
    picks = set()
    for _ in range(200):
        picked = cpu_affinity._pick(cores, 4)
        assert len(picked) == 4 and set(picked) <= set(cores)
        assert any(all((s + i) % 16 in picked for i in range(4)) for s in picked)
        picks.add(tuple(picked))
    assert len(picks) > 4


def test_a_windows_mask_round_trips():
    cores = [0, 2, 5, 63]
    assert cpu_affinity._mask_to_cores(cpu_affinity._cores_to_mask(cores)) == cores


def test_a_count_the_host_cannot_narrow_to_is_not_pinned():
    assert cpu_affinity.pin(os.getpid(), 0) is None
    assert cpu_affinity.pin(os.getpid(), len(cpu_affinity.host_cores() or []) + 1) is None


@pytest.mark.skipif(sys.platform != "linux", reason="sched_setaffinity is Linux's")
def test_pins_and_restores_this_process_on_linux():
    before = cpu_affinity.host_cores() or []
    if len(before) < 2:
        pytest.skip("one core: nothing to narrow")
    previous = cpu_affinity.pin(os.getpid(), 1)
    try:
        assert previous == before
        assert len(cpu_affinity.host_cores()) == 1
    finally:
        cpu_affinity.restore(os.getpid(), previous)
    assert cpu_affinity.host_cores() == before
