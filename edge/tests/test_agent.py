import re

from stepwise_edge.agent import INITIAL, INSTRUCTIONS, TOOLS
from stepwise_edge.api import _check_text
from stepwise_edge.coach import CoachSession

TASK = {"task_id": "t", "title": "Cup sleeve", "steps": [
    {"id": 1, "instruction": "Pick up the cup.", "correction": "Almost. Pick up the cup.", "why": "", "done_right": "", "common_mistake": ""},
    {"id": 2, "instruction": "Slide the sleeve on.", "correction": "Almost. Slide it to the middle.", "why": "", "done_right": "", "common_mistake": ""},
]}


def test_tools_fit_cartesia_client_tool_schema():
    names = [t["name"] for t in TOOLS]
    assert len(names) == len(set(names))
    for t in TOOLS:
        assert re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,63}", t["name"])
        assert t["type"] == "client" and t["pre_tool_speech"] in ("auto", "force", "off") and t["execution_mode"] in ("immediate", "async")
        assert 1 <= len(t["description"]) <= 2000 and t["parameters"]["type"] == "object"
        assert set(t["parameters"].get("required", [])) <= set(t["parameters"]["properties"])
        if t["expects_response"]:
            assert 1 <= t["response_timeout_secs"] <= 120
        else:
            assert "response_timeout_secs" not in t


def test_no_dynamic_variables_in_prompt():
    # Cartesia refuses dynamic_variables from browser access tokens; the agent gets context from tools
    assert "{{" not in INSTRUCTIONS and "{{" not in INITIAL
    for t in TOOLS:
        assert t["name"] in INSTRUCTIONS


def test_tone_rules_in_prompt():
    assert '"Almost."' in INSTRUCTIONS and "Never make up" in INSTRUCTIONS


def test_check_text_tells_the_agent_only_what_was_seen():
    s = CoachSession("w", "W", TASK)
    assert _check_text(s, {"status": "mistake", "reason": "the sleeve is at the top", "fix": "Slide it down."}).startswith("Almost.")
    assert "Not done yet" in _check_text(s, {"status": "in_progress", "hint": "Hold the cup."})
    assert "could not tell" in _check_text(s, {"status": "unclear"})
    s.advance()
    assert "Now Step 2 of 2: Slide the sleeve on." in _check_text(s, {"status": "done", "next": {"index": 1}})
    assert "last step" in _check_text(s, {"status": "done", "finished": True})
