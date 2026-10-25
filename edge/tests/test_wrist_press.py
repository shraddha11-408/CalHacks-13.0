"""POST /wrist/press: hold = call the supervisor (rings, CALL on the matrix), short touch = a quiet note."""
import asyncio

from stepwise_edge import api
from stepwise_edge.coach import CoachSession

TASK = {"task_id": "t", "title": "Cup", "steps": [{"id": 1, "instruction": "a"}, {"id": 2, "instruction": "b"}]}


class FakeStdb:
    def __init__(self):
        self.calls = []

    def call(self, name, *args):
        self.calls.append((name, args))


def setup(monkeypatch):
    db, hooks, photos = FakeStdb(), [], []
    monkeypatch.setattr(api, "stdb", lambda: db)
    monkeypatch.setattr(api, "say", lambda text: {"text": text, "url": None})
    monkeypatch.setattr(api, "task_voice", lambda task: None)
    monkeypatch.setattr(api, "save_photo", lambda kind, sid, jpg: photos.append(jpg) or f"/files/photos/{sid}/{kind}.jpg")
    monkeypatch.setattr(api, "HELP_SENT_HOOKS", [hooks.append])
    monkeypatch.setattr(api, "WRIST", {"last_press": {"call": 0.0, "notify": 0.0}, "presses": 0, "last": None})
    s = CoachSession("w1", "Jordan", TASK)
    s.snapshots.append(b"\xff\xd8frame")
    monkeypatch.setattr(api, "sessions", {s.id: s})
    return db, hooks, photos, s


def press(kind, sid):
    return asyncio.run(api.wrist_press(api.WristPress(session_id=sid, kind=kind)))


def test_hold_calls_the_supervisor_with_the_live_frame(monkeypatch):
    db, hooks, photos, s = setup(monkeypatch)
    r = press("call", s.id)
    assert r["ok"] and r["say"][0]["text"] == "Okay. I'm calling your supervisor now."
    assert db.calls[0] == ("call_supervisor", (s.id, "w1", "t", 1, f"/files/photos/{s.id}/wrist.jpg"))
    assert photos == [b"\xff\xd8frame"]
    assert hooks == [s.id]  # CALL on the wrist node


def test_short_touch_is_a_quiet_note_that_never_shows_call(monkeypatch):
    db, hooks, _, s = setup(monkeypatch)
    r = press("notify", s.id)
    assert r["ok"] and r["say"][0]["text"] == "Okay. I told your supervisor."
    assert db.calls[0][0] == "notify_supervisor"
    assert hooks == []


def test_a_double_tap_sends_once_but_a_note_then_a_call_both_go(monkeypatch):
    db, _, _, s = setup(monkeypatch)
    press("notify", s.id)
    assert press("notify", s.id)["duplicate"] is True
    press("call", s.id)
    assert [c[0] for c in db.calls if c[0] != "log_step_event"] == ["notify_supervisor", "call_supervisor"]


def test_default_kind_is_call(monkeypatch):
    db, _, _, s = setup(monkeypatch)
    asyncio.run(api.wrist_press(api.WristPress(session_id=s.id)))
    assert db.calls[0][0] == "call_supervisor"
