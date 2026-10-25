from stepwise_edge.live_vision import box_from_2d, build_prompt, parse, source_of

TASK = {"title": "Sleeve a cup", "steps": [
    {"id": 1, "instruction": "Pick up the cup.", "done_right": "Cup in hand.", "common_mistake": "Cup on table."},
    {"id": 2, "instruction": "Slide the sleeve on.", "done_right": "Sleeve around cup.", "common_mistake": "Sleeve upside down."},
]}


def test_box_2d_to_fractions():
    assert box_from_2d([100, 200, 500, 600]) == [0.2, 0.1, 0.4, 0.4]
    assert box_from_2d([500, 600, 100, 200]) == [0.2, 0.1, 0.4, 0.4]  # swapped corners
    assert box_from_2d([]) is None and box_from_2d([1, 2, 3]) is None and box_from_2d([0, 0, 5, 5]) is None


def test_parse_clamps_and_only_boxes_mistakes():
    r = parse({"status": "mistake", "confidence": 3, "done_through": 9, "box_2d": [0, 0, 1000, 500], "fix": "Turn it."}, total=2)
    assert r["confidence"] == 1.0 and r["done_through"] == 2 and r["box"] == [0.0, 0.0, 0.5, 1.0] and r["fix"] == "Turn it."
    r = parse({"status": "done", "confidence": 0.9, "done_through": 1, "box_2d": [0, 0, 1000, 500], "fix": "x"}, total=2)
    assert r["box"] is None and r["fix"] == ""
    assert parse({"status": "??"}, total=2)["status"] == "unclear"


def test_prompt_lists_every_step_and_current():
    p = build_prompt(TASK["steps"][1], TASK, has_ref=False)
    assert "1. [DONE] Pick up the cup." in p and "2. Slide the sleeve on." in p and 'step 2 of 2: "Slide the sleeve on."' in p
    assert "never ask the worker to go back" in p


def test_one_model_sonnet(monkeypatch):
    from stepwise_edge import live_vision as lv

    seen = {}
    monkeypatch.setattr(lv, "_claude_call", lambda model, *a: seen.setdefault("model", model) and {"status": "mistake", "confidence": 0.9, "done_through": 0, "fix": "Turn it."})
    r, _, src = lv.check({"claude_live": "claude-sonnet-5-5"}, b"x", None, TASK["steps"][1], TASK)
    assert seen["model"] == "claude-sonnet-5-5" and src == "sonnet" and r["status"] == "mistake" and r["fix"] == "Turn it."
    assert source_of("claude-haiku-5-5") == "haiku" and source_of("claude-opus-5-5") == "claude"
