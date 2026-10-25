"""Droid re-teach engineer, edge side: approve/renumber, duplicate refusal, name scrubbing (no network)."""
import json

import pytest

from stepwise_edge.droid import Jobs
from stepwise_edge.tasks import TaskStore


class FakeStdb:
    def __init__(self):
        self.calls = []

    def call(self, reducer, *args):
        self.calls.append((reducer, args))


def _step(i, text):
    return {"id": i, "instruction": text, "cue": "Cue.", "done_right": "ok", "common_mistake": "m",
            "correction": "Almost. Fix it.", "why": "w", "praise": "Nice.", "close_look": False}


@pytest.fixture
def env(tmp_path):
    store = TaskStore(tmp_path / "data")
    task = {"task_id": "t1", "title": "Sleeve a cup",
            "steps": [_step(1, "Pick up a cup."), {**_step(2, "Put the sleeve on."), "reference_photo": "/files/x.jpg", "start_s": 3.0, "end_s": 6.0}, _step(3, "Hand it over.")]}
    store.save(task)
    db = FakeStdb()
    repo = tmp_path / "repo"
    (repo / "droid").mkdir(parents=True)
    jobs = Jobs(repo, tmp_path / "data", store, lambda: db)
    return jobs, store, task, db, repo


def test_approve_splits_and_renumbers(env):
    jobs, store, task, db, _ = env
    jid = jobs.start(task, 2, "supervisor", "hard step", spawn=False)
    j = jobs.get(jid)
    assert jid.startswith("dj_") and len(jid) == 13
    j["status"], j["steps"] = "proposed", [_step(0, "Open the sleeve."), {**_step(0, "Slide it on the cup."), "close_look": True}]
    out = jobs.approve(jid)
    assert [s["id"] for s in out["steps"]] == [1, 2, 3, 4]
    assert out["steps"][1]["instruction"] == "Open the sleeve."
    assert out["steps"][1]["reference_photo"] == "/files/x.jpg" and out["steps"][1]["start_s"] == 3.0
    assert "reference_photo" not in out["steps"][2]
    assert out["steps"][3]["instruction"] == "Hand it over."
    assert store.get("t1")["steps"][2]["close_look"] is True
    assert any(c[0] == "save_task" for c in db.calls)
    assert jobs.get(jid)["status"] == "approved"
    assert json.loads((jobs.dir / f"{jid}.json").read_text())["status"] == "approved"


def test_duplicate_active_refused(env):
    jobs, _, task, _, _ = env
    assert jobs.start(task, 2, "supervisor", spawn=False)
    assert jobs.start(task, 2, "supervisor", spawn=False) is None
    assert jobs.start(task, 3, "supervisor", spawn=False)


def test_auto_cooldown_after_reject(env):
    jobs, _, task, _, _ = env
    jid = jobs.start(task, 1, "auto", spawn=False)
    jobs.reject(jid)
    assert jobs.start(task, 1, "auto", spawn=False) is None  # one auto job per step per hour
    assert jobs.start(task, 1, "supervisor", spawn=False)  # a supervisor can still ask


def test_evidence_scrubs_worker_names(env):
    jobs, _, task, _, repo = env
    ev = {"names": ["Jordan"], "notes": ["Jordan had trouble with the sleeve.", "jordan likes short words"],
          "trouble": [{"ts": 1, "kind": "correction", "reason": "Jordan put it upside down", "correction": "Almost. Turn it over, Jordan."},
                      {"ts": 2, "kind": "help"}]}
    jid = jobs.start(task, 2, "auto", "2 corrections/help in the last hour", ev, spawn=False)
    md = (repo / "droid" / "sandboxes" / jid / "evidence.md").read_text()
    body, names = md.split("Names:", 1)
    assert "jordan" not in body.lower()
    assert "the worker had trouble" in body and "Jordan" in names
    assert "Target step number: 2" in body and "Help requests on this step: 1" in body
    assert json.loads((repo / "droid" / "sandboxes" / jid / "task.json").read_text())["task_id"] == "t1"
