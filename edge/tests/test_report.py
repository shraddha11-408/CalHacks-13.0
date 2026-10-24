from stepwise_edge.report import stats, trend


def test_trend():
    assert trend([3]) == "not_enough_data"
    assert trend([3, 2, 1, 0]) == "improving"
    assert trend([0, 0, 2, 3]) == "more_mistakes_lately"
    assert trend([1, 1]) == "steady"


def test_stats_counts_spoken_mistakes_per_attempt_in_time_order():
    sessions = [
        {"id": "b", "task_id": "t", "task_title": "Cup", "started_at": "2026-10-24T10:10:00Z", "ended_at": "2026-10-24T10:12:00Z", "status": "done", "steps_total": 3},
        {"id": "a", "task_id": "t", "task_title": "Cup", "started_at": "2026-10-24T10:00:00Z", "ended_at": None, "status": "stopped", "steps_total": 3},
    ]
    events = [
        {"session_id": "a", "kind": "mistake", "step_text": "Sleeve", "note": "upside down"},
        {"session_id": "a", "kind": "mistake", "step_text": "Sleeve", "note": "upside down"},
        {"session_id": "a", "kind": "mistake_repeat", "step_text": "Sleeve", "note": "upside down"},
        {"session_id": "b", "kind": "done", "step_id": 1, "step_text": "Cup"},
        {"session_id": "b", "kind": "done", "step_id": 1, "step_text": "Cup"},
    ]
    st = stats(sessions, events, [{"step_text": "Sleeve", "status": "resolved"}])
    t = st["tasks"][0]
    assert t["mistakes_per_attempt"] == [2, 0] and t["trend"] == "improving"
    assert t["times_done"] == 2 and t["times_finished"] == 1 and t["attempts"][1]["minutes"] == 2.0
    assert t["attempts"][1]["steps_done"] == 1  # a step counted once, however many "done" rows
    assert t["hardest_steps"][0] == {"step": "Sleeve", "mistakes": 2}
    assert st["help_requests"] == 1 and st["mistakes_total"] == 2
