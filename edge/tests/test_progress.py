from stepwise_edge.progress import session_numbers, template

M = 60_000_000  # one minute in microseconds
SESS = [
    {"id": "old", "task_id": "cup_v1", "status": "done", "started_at": [10 * M], "ended_at": [0, [14 * M]]},
    {"id": "now", "task_id": "cup_v2", "status": "done", "started_at": [100 * M], "ended_at": [0, [102 * M]]},
    {"id": "other", "task_id": "towel", "status": "done", "started_at": [50 * M], "ended_at": [1, []]},
]
EV = [
    {"session_id": "old", "step_id": 1, "kind": "done"},
    {"session_id": "old", "step_id": 2, "kind": "mistake"},
    {"session_id": "old", "step_id": 2, "kind": "mistake"},
    {"session_id": "old", "step_id": 2, "kind": "done"},
    {"session_id": "now", "step_id": 1, "kind": "done"},
    {"session_id": "now", "step_id": 2, "kind": "done"},
    {"session_id": "now", "step_id": 3, "kind": "mistake"},
    {"session_id": "now", "step_id": 3, "kind": "done"},
    {"session_id": "now", "step_id": 3, "kind": "done"},  # duplicate rows count once
]
TITLES = {"cup_v1": "Sleeve a cup", "cup_v2": "Sleeve a cup", "towel": "Fold a towel"}


def test_numbers_today_and_last_time_same_title_across_reteach():
    n = session_numbers("now", SESS, EV, TITLES, 3)
    assert (n["steps_done"], n["by_self"], n["corrections"], n["minutes"], n["times_done"]) == (3, 2, 1, 2.0, 2)
    assert n["last_time"] == {"by_self": 1, "corrections": 2, "minutes": 4.0, "finished": True}


def test_template_states_only_facts():
    n = session_numbers("now", SESS, EV, TITLES, 3)
    t = template("Jordan", n)
    assert t.startswith("You did 2 steps by yourself today!") and "fewer reminders than last time" in t
    assert template("Jordan", {}) == "Good work today!"
