"""Wrist node over USB serial: the timing and help routing are the product (AGENTS.md §26)."""
import threading
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


def run_node(lines_and_times, on_help=None, on_what_now=None):
    """lines_and_times: [(b"DOWN\\n", t), ...]; the clock reads t when that line is returned."""
    clock = Clock()
    calls = []
    node = WristNode(on_help=on_help or (lambda: calls.append("help")),
                     on_what_now=on_what_now or (lambda: calls.append("what_now")), clock=clock)
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


def test_long_hold_is_help_short_touch_is_what_now():
    calls, _ = run_node([(b"DOWN\n", 0.0), (b"UP\n", HOLD_FOR_HELP_S + 0.1),
                         (b"DOWN\n", 5.0), (b"UP\n", 5.3)])
    assert calls == ["help", "what_now"]


def test_exactly_the_threshold_counts_as_help():
    calls, _ = run_node([(b"DOWN\n", 0.0), (b"UP\n", HOLD_FOR_HELP_S)])
    assert calls == ["help"]


def test_up_without_down_and_noise_are_ignored():
    calls, written = run_node([(b"UP\n", 0.0), (b"garbage\n", 0.1), (b"\n", 0.2)])
    assert calls == [] and written == []


def test_an_app_error_does_not_break_the_wrist_loop():
    calls = []

    def boom():
        raise RuntimeError("app bug")

    got, _ = run_node([(b"DOWN\n", 0.0), (b"UP\n", 2.0), (b"DOWN\n", 3.0), (b"UP\n", 3.2)],
                      on_help=boom, on_what_now=lambda: calls.append("what_now"))
    assert calls == ["what_now"]


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


# ---------- help routing ----------

def session(sid, help_count=0):
    return SimpleNamespace(id=sid, step={"id": 2}, flags={2: {"help": help_count}} if help_count else {})


class Router:
    def __init__(self, sessions):
        self.events, self.sent, self.buzz, self.timers = [], [], [], []
        self.r = HelpRouter(sessions, lambda t, **d: self.events.append((t, d)), self.sent.append,
                            timer=lambda s, fn, args: SimpleNamespace(start=lambda: self.timers.append((fn, args))))
        self.r.node = SimpleNamespace(send=self.buzz.append)

    def fire_timers(self):
        for fn, args in self.timers:
            fn(*args)


def test_help_goes_to_the_page_of_the_newest_session():
    t = Router({"old": session("old"), "new": session("new")})
    t.r.on_help()
    assert t.events == [("wrist", {"action": "help", "sid": "new", "already": False})]
    assert t.buzz == []  # CALL only once help is really sent


def test_page_sends_help_then_buzz_and_no_server_duplicate():
    t = Router({"s1": session("s1")})
    t.r.on_help()
    t.r.help_sent("s1")  # the page called /coach/s1/help
    t.fire_timers()
    assert t.buzz == ["BUZZ"]
    assert t.sent == []
    assert ("help_sent", {"sid": "s1"}) in t.events


def test_server_sends_help_when_no_page_answers():
    t = Router({"s1": session("s1")})
    t.r.on_help()
    t.fire_timers()
    assert t.sent == ["s1"]


def test_no_fallback_for_a_session_that_ended_meanwhile():
    sessions = {"s1": session("s1")}
    t = Router(sessions)
    t.r.on_help()
    sessions.clear()
    t.fire_timers()
    assert t.sent == []


def test_second_hold_on_the_same_step_shows_call_but_does_not_page_again():
    t = Router({"s1": session("s1", help_count=1)})
    t.r.on_help()
    assert t.events[0] == ("wrist", {"action": "help", "sid": "s1", "already": True})
    assert t.buzz == ["BUZZ"] and t.timers == [] and t.sent == []


def test_help_with_no_session_is_reported_not_lost_silently():
    t = Router({})
    t.r.on_help()
    assert t.events == [("wrist", {"action": "no_session"})]
    assert t.buzz == [] and t.timers == []


def test_what_now_targets_the_running_session():
    t = Router({"s1": session("s1")})
    t.r.on_what_now()
    assert t.events == [("wrist", {"action": "what_now", "sid": "s1"})]


def test_help_from_button_or_voice_also_shows_call():
    t = Router({"s1": session("s1")})
    t.r.help_sent("s1")
    assert t.buzz == ["BUZZ"]
