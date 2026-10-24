from stepwise_edge.live_vision import box_from_2d, build_prompt, parse, provider

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
    assert "1. Pick up the cup." in p and "2. Slide the sleeve on." in p and 'step 2 of 2: "Slide the sleeve on."' in p


def test_auto_provider(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert provider("auto") == "claude"
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    assert provider("auto") == "gemini" and provider("claude") == "claude"


def test_auto_falls_back_to_claude_when_gemini_is_busy(monkeypatch):
    from stepwise_edge import live_vision as lv

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(lv, "_gemini_rest_until", 0.0)
    monkeypatch.setattr(lv, "_gemini_call", lambda *a: (_ for _ in ()).throw(RuntimeError("429 RESOURCE_EXHAUSTED")))
    monkeypatch.setattr(lv, "_claude_call", lambda *a: {"status": "in_progress", "confidence": 0.8, "done_through": 0})
    models = {"live_vision": "auto", "gemini_live": "g", "claude_live": "claude-haiku-5-5"}
    r, _, src = lv.check(models, b"x", None, TASK["steps"][0], TASK)
    assert src == "haiku" and r["status"] == "in_progress"
    assert lv.provider("auto") == "claude"  # resting
