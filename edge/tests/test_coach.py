from stepwise_edge.coach import CoachSession, intent_of, spoken_tip

TASK = {"task_id": "t", "title": "Fold a towel", "steps": [{"id": 1, "instruction": "a"}, {"id": 2, "instruction": "b"}]}


def test_low_confidence_counts_as_unclear():
    s = CoachSession("w", "W", TASK)
    assert s.classify({"status": "mistake", "confidence": 0.4}, 0.6) == "unclear"
    assert s.classify({"status": "done", "confidence": 0.9}, 0.6) == "done"
    assert s.classify({"status": "in_progress", "confidence": 0.1}, 0.6) == "in_progress"


def test_escalates_on_second_unclear():
    s = CoachSession("w", "W", TASK)
    assert s.note_unclear(2) is False
    assert s.note_unclear(2) is True


def test_advance_resets_and_finishes():
    s = CoachSession("w", "W", TASK)
    s.note_unclear(2)
    s.snapshots.append(b"x")
    assert s.advance() is False and s.step_index == 1 and s.unclear == 0 and not s.snapshots
    assert s.advance() is True and s.finished


def test_intents():
    assert intent_of("Is this correct?") == "check"
    assert intent_of("I'm done") == "check"
    assert intent_of("what's next") == "next"
    assert intent_of("say that again") == "repeat"
    assert intent_of("why do I do that") == "why"
    assert intent_of("I'm stuck") == "stuck" and intent_of("I don't know") == "stuck"
    assert intent_of("help me please") == "help"
    assert intent_of("where do the towels go after") == "open"


def test_spoken_tip():
    assert spoken_tip("Almost. Smooth it out so it's flat.") == "Remember: smooth it out so it's flat."
    assert spoken_tip("Almost.") == ""


def test_parse_box_fractions_pixels_and_junk():
    from stepwise_edge.vision import parse_box, parse_check

    assert parse_box([0.1, 0.2, 0.3, 0.4]) == [0.1, 0.2, 0.3, 0.4]
    assert parse_box([51.2, 102.4, 256, 128]) == [0.1, 0.2, 0.5, 0.25]
    assert parse_box([0.9, 0.9, 0.5, 0.5]) == [0.9, 0.9, 0.1, 0.1]
    assert parse_box([]) is None and parse_box("x") is None and parse_box([0, 0, 0, 0]) is None
    r = parse_check('think... {"status": "mistake", "confidence": 0.9, "reason": "upside down", "box": [0.2, 0.5, 0.3, 0.3], "fix": "Turn it over."}')
    assert r["status"] == "mistake" and r["box"] == [0.2, 0.5, 0.3, 0.3] and r["fix"] == "Turn it over."


def test_done_needs_two_in_a_row_one_second_apart():
    s = CoachSession("w", "W", TASK)
    assert s.note_done(10.0, 2, 1.0) is False  # first look
    assert s.note_done(10.4, 2, 1.0) is False  # too soon to count
    assert s.note_done(11.2, 2, 1.0) is True  # second look, >= 1 s later
    s.advance()
    assert s.done_streak == 0
    assert s.note_done(20.0, 2, 1.0) is False
    s.not_done()  # any other verdict breaks the streak
    assert s.note_done(21.5, 2, 1.0) is False


def test_low_confidence_done_is_unclear():
    s = CoachSession("w", "W", TASK)
    assert s.classify({"status": "done", "confidence": 0.7}, 0.6, 0.75) == "unclear"
    assert s.classify({"status": "done", "confidence": 0.8}, 0.6, 0.75) == "done"


def test_mistake_debounce_and_cooldown():
    s = CoachSession("w", "W", TASK)
    assert s.note_mistake(0.0, 2, 10) == "wait"
    assert s.note_mistake(1.0, 2, 10) == "speak"
    assert s.note_mistake(2.0, 2, 10) == "quiet"  # no nagging
    s.not_mistake()
    assert s.note_mistake(5.0, 2, 10) == "wait"
    assert s.note_mistake(12.0, 2, 10) == "speak"  # cooldown over
    s.advance()
    assert s.mistake_streak == 0 and s.note_mistake(13.0, 2, 10) == "wait"


def test_stuck_levels_fire_once_each_and_reset_on_new_step():
    s = CoachSession("w", "W", TASK)
    t0 = s.step_started_at
    after = [15, 35, 60]
    assert s.stuck_due(t0 + 5, after) is None
    assert s.stuck_due(t0 + 16, after) == 0
    assert s.stuck_due(t0 + 17, after) is None  # level 0 only once
    assert s.stuck_due(t0 + 36, after) == 1
    assert s.stuck_due(t0 + 61, after) == 2
    assert s.stuck_due(t0 + 999, after) is None
    s.advance()
    assert s.stuck_level == 0 and s.stuck_due(s.step_started_at + 16, after) == 0


def test_echo_guard_ignores_the_apps_own_voice():
    s = CoachSession("w", "W", TASK)
    s.note_spoken(["Great job!", "Pick up the paper coffee cup with the lid."], now=100.0)
    assert s.is_echo("pick up the paper coffee cup with the lid", now=105.0)
    assert s.is_echo("great job", now=101.0)
    assert not s.is_echo("is this the right cup?", now=105.0)
    assert not s.is_echo("pick up the paper coffee cup with the lid", now=200.0)  # long ago: the worker repeating it
