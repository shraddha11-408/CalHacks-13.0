"""Wrist node over USB serial: the timing and help routing are the product (AGENTS.md §26)."""
import threading
from concurrent.futures import Future
from types import SimpleNamespace

from stepwise_edge.wrist import ARDUINO_VID, HOLD_FOR_HELP_S, HelpRouter, WristNode, find_port


class FakeSerial:
    """Replays lines; stops the node when it runs out. Records what the laptop wrote."""

    def __init__(self, node, lines):
        self.node, self.lines, self.written = node, list(lines), []

    def readline(self):
        if not self.lines:
            self.node._stop.set()
            return b""
        return self.lines.pop(0)

    def write(self, data):
        self.written.append(data)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def run_node(lines_and_times, on_hold=None, on_touch=None):
    """lines_and_times: [(b"DOWN\\n", t), ...]; the clock reads t when that line is returned."""
    clock = Clock()
    calls = []
    node = WristNode(on_hold=on_hold or (lambda: calls.append("call")),
                     on_touch=on_touch or (lambda: calls.append("notify")), clock=clock)
    times = iter([t for _, t in lines_and_times])

    class TimedSerial(FakeSerial):
        def readline(self):
            line = super().readline()
            if line:
                clock.t = next(times)
            return line

    ser = TimedSerial(node, [l for l, _ in lines_and_times])
    node._ser = ser
    node._read(ser)
    return calls, ser.written


# ---------- port detection ----------

def test_configured_port_wins():
    assert find_port("COM5", list_ports=lambda: [SimpleNamespace(device="COM9", vid=ARDUINO_VID)]) == "COM5"


def test_arduino_found_by_vendor_id_on_any_os():
    ports = [SimpleNamespace(device="COM3", vid=0x1234), SimpleNamespace(device="COM7", vid=ARDUINO_VID)]
    assert find_port("auto", list_ports=lambda: ports, globber=lambda p: []) == "COM7"


def test_usb_modem_fallback_when_no_vendor_id():
    glob = lambda p: ["/dev/ttyACM0"] if "ttyACM" in p else []
    assert find_port("auto", list_ports=lambda: [], globber=glob) == "/dev/ttyACM0"


def test_nothing_plugged_in():
    assert find_port("auto", list_ports=lambda: [], globber=lambda p: []) is None
    assert find_port("", list_ports=lambda: [], globber=lambda p: []) is None


# ---------- touch timing ----------

def test_touch_down_is_acknowledged_right_away():
    _, written = run_node([(b"DOWN\n", 0.0)])
    assert written == [b"ACK\n"]


def test_long_hold_calls_short_touch_notifies():
    calls, _ = run_node([(b"DOWN\n", 0.0), (b"UP\n", HOLD_FOR_HELP_S + 0.1),
                         (b"DOWN\n", 5.0), (b"UP\n", 5.3)])
    assert calls == ["call", "notify"]


def test_exactly_the_threshold_counts_as_help():
    calls, _ = run_node([(b"DOWN\n", 0.0), (b"UP\n", HOLD_FOR_HELP_S)])
    assert calls == ["call"]


def test_up_without_down_and_noise_are_ignored():
    calls, written = run_node([(b"UP\n", 0.0), (b"garbage\n", 0.1), (b"\n", 0.2)])
    assert calls == [] and written == []


def test_an_app_error_does_not_break_the_wrist_loop():
    calls = []

    def boom():
        raise RuntimeError("app bug")

    got, _ = run_node([(b"DOWN\n", 0.0), (b"UP\n", 2.0), (b"DOWN\n", 3.0), (b"UP\n", 3.2)],
                      on_hold=boom, on_touch=lambda: calls.append("notify"))
    assert calls == ["notify"]


def test_send_is_false_when_not_connected():
    assert WristNode().send("BUZZ") is False


def test_reconnects_after_unplug():
    opened = []
    node = WristNode(retry_s=0.01, find=lambda p: "COM5")

    def opener(port):
        opened.append(port)
        if len(opened) == 1:
            raise OSError("unplugged")
        return FakeSerial(node, [])  # second try connects, then ends the test

    node.opener = opener
    node._run()
    assert opened == ["COM5", "COM5"]


def test_waits_quietly_when_no_board():
    node = WristNode(retry_s=0.01, find=lambda p: None)
    t = threading.Thread(target=node._run)
    t.start()
    node._stop.wait(0.05)
    node._stop.set()
    t.join(1)
    assert "no Uno Q found" in node.status


# ---------- routing: hold = call the supervisor, short touch = a quiet note ----------

def session(sid):
    return SimpleNamespace(id=sid, step={"id": 2}, flags={})


class Router:
    """press() returns a done Future with the reply api.wrist_press would give."""

    def __init__(self, sessions, reply=None, fail=False):
        self.events, self.pressed, self.buzz = [], [], []

        def press(kind, sid):
            self.pressed.append((kind, sid))
            f = Future()
            if fail:
                f.set_exception(RuntimeError("edge down"))
            else:
                f.set_result(reply if reply is not None else {"ok": True, "say": [{"text": kind}], "duplicate": False})
            return f

        self.r = HelpRouter(sessions, lambda t, **d: self.events.append((t, d)), press)
        self.r.node = SimpleNamespace(send=self.buzz.append)


def test_hold_calls_the_supervisor_for_the_newest_session():
    t = Router({"old": session("old"), "new": session("new")})
    t.r.on_hold()
    assert t.pressed == [("call", "new")]
    assert t.events == [("wrist", {"action": "call", "sid": "new", "say": [{"text": "call"}], "duplicate": False})]


def test_short_touch_sends_a_quiet_note():
    t = Router({"s1": session("s1")})
    t.r.on_touch()
    assert t.pressed == [("notify", "s1")]
    assert t.events[0][1]["action"] == "notify"
    assert t.buzz == ["NOTE"]  # a check mark on the matrix, never CALL


def test_call_shows_call_once_help_is_sent():
    # api.wrist_press runs HELP_SENT_HOOKS for a call; the router's hook buzzes
    t = Router({"s1": session("s1")})
    t.r.on_hold()
    assert t.buzz == []
    t.r.help_sent("s1")
    assert t.buzz == ["BUZZ"] and ("help_sent", {"sid": "s1"}) in t.events


def test_nothing_sent_and_no_event_when_the_edge_says_no():
    t = Router({"s1": session("s1")}, reply={"ok": False, "error": "no worker"})
    t.r.on_hold()
    t.r.on_touch()
    assert t.events == [] and t.buzz == []  # no CALL and no check mark for something that did not go out


def test_a_failed_press_does_not_raise():
    t = Router({"s1": session("s1")}, fail=True)
    t.r.on_hold()
    assert t.events == [] and t.buzz == []


def test_press_with_no_session_is_reported_not_lost_silently():
    t = Router({})
    t.r.on_hold()
    t.r.on_touch()
    assert t.pressed == []
    assert t.events == [("wrist", {"action": "no_session", "kind": "call"}), ("wrist", {"action": "no_session", "kind": "notify"})]


def test_help_from_button_or_voice_also_shows_call():
    t = Router({"s1": session("s1")})
    t.r.help_sent("s1")
    assert t.buzz == ["BUZZ"]
