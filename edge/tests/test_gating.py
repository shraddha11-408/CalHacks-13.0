import numpy as np

from stepwise_edge.gating import FrameGate

FPS = 30


def still(n, base, t, gate, jitter=2):
    rng = np.random.default_rng(int(t * 1000) % 2**31)
    out = []
    for _ in range(n):
        f = np.clip(base.astype(int) + rng.integers(-jitter, jitter + 1, base.shape), 0, 255).astype(np.uint8)
        out.append(gate.update(f, t))
        t += 1 / FPS
    return out, t


def moving(n, base, t, gate):
    out = []
    for i in range(n):
        f = base.copy()
        x = 40 + (i * 25) % 500
        f[150:330, x : x + 120] = 255  # a hand sweeping across ~15% of the frame
        out.append(gate.update(f, t))
        t += 1 / FPS
    return out, t


def test_fires_once_after_change_then_settle():
    gate = FrameGate(settle_s=0.5)
    base = np.full((480, 640), 120, np.uint8)
    r, t = still(30, base, 0.0, gate)  # initial still: fires once (tray already in place)
    assert sum(x.fire for x in r) == 1
    r, t = still(60, base, t, gate)  # nothing changes: no more checks
    assert sum(x.fire for x in r) == 0
    r, t = moving(15, base, t, gate)
    assert all(x.state == "moving" for x in r[1:])
    assert not any(x.fire for x in r)
    r, t = still(10, base, t, gate)  # 0.33 s still: not yet
    assert not any(x.fire for x in r)
    r, t = still(10, base, t, gate)  # passes 0.5 s: fire exactly once
    assert sum(x.fire for x in r) == 1
    assert r[-1].state == "settled"


def test_fire_time_matches_settle_window():
    gate = FrameGate(settle_s=0.5)
    base = np.full((480, 640), 120, np.uint8)
    _, t = still(30, base, 0.0, gate)
    _, t = moving(10, base, t, gate)
    t_still = t
    fired_at = None
    for i in range(40):
        if gate.update(base, t).fire:
            fired_at = t
            break
        t += 1 / FPS
    assert fired_at is not None
    assert 0.5 <= fired_at - t_still <= 0.5 + 2 / FPS


def test_small_local_change_counts_as_movement():
    """A hand in one slot is a small mean change but must still re-arm the gate."""
    gate = FrameGate(settle_s=0.5)
    base = np.full((480, 640), 120, np.uint8)
    _, t = still(30, base, 0.0, gate)
    f = base.copy()
    f[200:280, 300:380] = 250  # ~2% of the frame, mean diff only ~2.7
    assert gate.update(f, t).state == "moving"


def test_sensor_noise_does_not_trigger():
    gate = FrameGate(settle_s=0.5)
    base = np.full((480, 640), 120, np.uint8)
    r, _ = still(200, base, 0.0, gate, jitter=6)
    assert sum(x.fire for x in r) == 1  # only the initial settle
    assert all(x.state != "moving" for x in r)


def test_flicker_between_thresholds_delays_fire():
    gate = FrameGate(settle_s=0.5, change_frac=0.02, still_frac=0.005)
    base = np.full((480, 640), 120, np.uint8)
    _, t = still(30, base, 0.0, gate)
    _, t = moving(5, base, t, gate)
    fired = False
    for i in range(30):  # alternate between a still frame and a ~1% change (in-between band)
        f = base.copy()
        if i % 2:
            f[0:48, 0:64] = 250  # 1% of pixels
        fired |= gate.update(f, t).fire
        t += 1 / FPS
    assert not fired
