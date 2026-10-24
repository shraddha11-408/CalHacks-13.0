from stepwise_edge import api
from stepwise_edge.coach import CoachSession

TASK = {"task_id": "t", "title": "Cup", "steps": [{"id": 1, "instruction": "a", "praise": "You picked up the cup!"}, {"id": 2, "instruction": "b"}]}


def test_praise_rotates_and_names_the_step():
    s = CoachSession("w", "W", TASK)
    first = [x["text"] for x in api._praise(s, TASK["steps"][0])]
    second = [x["text"] for x in api._praise(s, TASK["steps"][1])]
    assert first[1] == "You picked up the cup!" and len(second) == 1
    assert first[0] != second[0]  # not the same "Great!" every time
