"""Stepwise edge app: FastAPI on localhost:8000.

Camera → gate → rectify runs on a background thread (pipeline.py). This app
serves the local views (MJPEG), pushes events over a WebSocket, and holds the
HSV calibration endpoints. Everything here is localhost-only; the raw view is
never sent anywhere.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from urllib.parse import urljoin

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import ROOT, load_config, save_hsv
from cvlib import hsv_range_from_patch, load_hsv  # noqa: E402  (path set up in config)

from . import api
from .camera import make_camera
from .events import EventBus
from .pipeline import Pipeline
from .wrist import HelpRouter, WristNode

CONFIG = load_config()
bus = EventBus()
state: dict = {"pipeline": None, "camera_error": None, "wrist": None}
log = logging.getLogger("stepwise.main")

# Names only. Values are never returned, printed or logged.
SECRET_KEYS = [
    "ANTHROPIC_API_KEY",
    "BITDEER_API_KEY",
    "CARTESIA_API_KEY",
    "CARTESIA_VOICE_ID",
    "FACTORY_API_KEY",
    "SPACETIMEDB_MODULE",
    "MOSS_PROJECT_ID",
    "MOSS_PROJECT_KEY",
]


def _start_wrist(loop: asyncio.AbstractEventLoop) -> WristNode | None:
    """devices.wrist: uno_q -> the Uno Q wrist node on USB serial (wrist.py). Touches reach the worker's
    page as "wrist" events on the WebSocket; the page sends the help request with a photo."""
    if CONFIG["devices"].get("wrist") != "uno_q":
        return None

    def send_help(sid: str) -> None:
        # No page answered the wrist event: run the normal help route on the event loop.
        fut = asyncio.run_coroutine_threadsafe(api.coach_help(sid, api.HelpReq()), loop)
        fut.add_done_callback(lambda f: f.exception() and log.warning("wrist help failed: %s", f.exception()))

    router = HelpRouter(api.sessions, bus.publish, send_help)
    node = WristNode(CONFIG["devices"].get("wrist_port", "auto"), on_help=router.on_help, on_what_now=router.on_what_now)
    router.node = node
    api.HELP_SENT_HOOKS.append(router.help_sent)
    return node.start()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    bus.bind(asyncio.get_running_loop())
    cam = None
    await api.startup()
    state["wrist"] = _start_wrist(asyncio.get_running_loop())
    # The MVP coach loop runs the camera in the browser (MediaPipe). The edge-side
    # ArUco pipeline is opt-in (devices.edge_camera) so it doesn't hold the webcam.
    if CONFIG["devices"].get("edge_camera") and os.getenv("STEPWISE_NO_CAMERA") != "1":
        try:
            cam = make_camera(CONFIG["devices"]).start()
            state["pipeline"] = Pipeline(cam, CONFIG, bus).start()
        except Exception as e:  # camera missing or permission denied: app still serves
            state["camera_error"] = str(e)
    yield
    if state["wrist"]:
        state["wrist"].stop()
    if state["pipeline"]:
        state["pipeline"].stop()
    if cam:
        cam.stop()


app = FastAPI(title="Stepwise edge", lifespan=lifespan)
app.include_router(api.router)
api.mount_files(app)


def _pipe() -> Pipeline:
    p = state["pipeline"]
    if p is None:
        raise HTTPException(503, state["camera_error"] or "camera not started")
    return p


@app.get("/health")
def health() -> dict:
    p = state["pipeline"]
    return {
        "ok": True,
        "devices": {k: CONFIG["devices"][k] for k in ("camera", "mic", "speaker", "wrist")},
        "camera": "ok" if p and not p.camera.error else (p.camera.error if p else state["camera_error"] or "browser"),
        "wrist": state["wrist"].status if state["wrist"] else "off",
        "spacetimedb": api.stdb().public() | {"error": api.stdb().error},
        "voice_error": api.voice.error,
        "memory_error": api.memory.error,
        "keys_present": {k: bool(os.getenv(k)) for k in SECRET_KEYS},
    }


@app.get("/stats")
def stats() -> dict:
    return _pipe().stats()


# ---------- MJPEG ----------
def _placeholder(text: str, size=(800, 600)) -> np.ndarray:
    img = np.full((size[1], size[0], 3), (40, 36, 34), np.uint8)
    cv2.putText(img, text, (30, size[1] // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (200, 200, 200), 2)
    return img


def _mjpeg(which: str, fps: float = 15):
    boundary = b"--frame"
    period = 1.0 / fps
    while True:
        t0 = time.monotonic()
        p = state["pipeline"]
        img = p.latest(which) if p else None
        if img is None:
            img = _placeholder("Look at the tray" if p and which == "tray" else "No camera" if not p else "Starting...")
        ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if ok:
            yield boundary + b"\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpg)).encode() + b"\r\n\r\n" + jpg.tobytes() + b"\r\n"
        time.sleep(max(0.0, period - (time.monotonic() - t0)))


@app.get("/stream/raw.mjpg")
def stream_raw():
    """Raw camera view with marker + gate overlays. Local only — contains the room."""
    return StreamingResponse(_mjpeg("raw"), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/stream/glasses.mjpg")
async def stream_glasses():
    """The glasses camera (Pi 5 + Brio 100, devices.pi_stream_url) passed through as is. The page is
    https and the Pi is plain http with no CORS, so the browser reads it here, same origin. Local only:
    the browser blurs faces before any frame leaves it, as with the webcam."""
    return await _pi_passthrough(CONFIG["devices"]["pi_stream_url"], "camera", "multipart/x-mixed-replace; boundary=frame")


@app.get("/stream/glasses.pcm")
async def stream_glasses_mic():
    """The glasses mic (Brio 100 on the Pi, served at /audio): 16 kHz mono s16le, passed through as is."""
    url = urljoin(CONFIG["devices"]["pi_stream_url"], "/audio")
    return await _pi_passthrough(url, "mic", "audio/L16; rate=16000; channels=1")


async def _pi_passthrough(url: str, what: str, default_type: str) -> StreamingResponse:
    client = httpx.AsyncClient(timeout=httpx.Timeout(5.0, read=10.0))
    try:
        resp = await client.send(client.build_request("GET", url), stream=True)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        await client.aclose()
        raise HTTPException(503, f"Glasses {what} not reachable at {url} ({type(e).__name__}). Is the Pi's USB-C cable in?")

    async def body():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        except httpx.HTTPError:
            pass  # Pi unplugged mid-stream: end the response, the page reconnects
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(body(), media_type=resp.headers.get("content-type", default_type), headers={"Cache-Control": "no-store"})


@app.get("/stream/tray.mjpg")
def stream_tray():
    """Rectified top-down tray: the only image that may leave the device."""
    return StreamingResponse(_mjpeg("tray"), media_type="multipart/x-mixed-replace; boundary=frame")


# ---------- events ----------
@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    await ws.accept()
    q = bus.subscribe()
    try:
        for e in list(bus.recent)[-10:]:
            await ws.send_text(json.dumps(e))
        while True:
            await ws.send_text(json.dumps(await q.get()))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        bus.unsubscribe(q)


# ---------- HSV calibration ----------
class SampleReq(BaseModel):
    x: float  # normalized 0–1 on the rectified tray image
    y: float
    radius: int = 10  # px half-size of the sampled square


class SaveReq(BaseModel):
    item: str
    lo: list[int]
    hi: list[int]


@app.post("/calibrate/hsv/sample")
def hsv_sample(req: SampleReq) -> dict:
    tray = _pipe().latest("tray")
    if tray is None:
        raise HTTPException(409, "No rectified tray right now (are all 4 markers in view?)")
    h, w = tray.shape[:2]
    cx, cy, r = int(req.x * w), int(req.y * h), max(2, req.radius)
    patch = tray[max(cy - r, 0) : cy + r, max(cx - r, 0) : cx + r]
    if patch.size == 0:
        raise HTTPException(400, "Point is outside the tray image")
    lo, hi = hsv_range_from_patch(patch)
    b, g, rr = (int(v) for v in patch.reshape(-1, 3).mean(axis=0))
    return {"lo": list(lo), "hi": list(hi), "rgb": [rr, g, b], "x": cx, "y": cy}


@app.get("/calibrate/hsv")
def hsv_get() -> dict:
    return {k: {"lo": list(v[0]), "hi": list(v[1])} for k, v in load_hsv(ROOT / "config.yaml").items()}


@app.post("/calibrate/hsv")
def hsv_save(req: SaveReq) -> dict:
    if not req.item.isidentifier():
        raise HTTPException(400, "item must be a simple name like 'soap'")
    if len(req.lo) != 3 or len(req.hi) != 3:
        raise HTTPException(400, "lo and hi need 3 values (H, S, V)")
    hsv = save_hsv(req.item, req.lo, req.hi)
    bus.publish("hsv_saved", item=req.item, lo=req.lo, hi=req.hi)
    return {"saved": req.item, "hsv": hsv}


# ---------- kill-tests ----------
KILLTESTS = ROOT / "scripts" / "killtests" / "results.json"
KILLTEST_ORDER = ["camera", "aruco", "bitdeer", "cartesia", "spacetime", "droid", "moss"]


@app.get("/killtests")
def killtests() -> dict:
    """Foundation kill-test results (measured, written by scripts/killtests/*)."""
    data = json.loads(KILLTESTS.read_text()) if KILLTESTS.exists() else {}
    rows = [{"test": k, **data[k]} if k in data else {"test": k, "status": "not_run"} for k in KILLTEST_ORDER]
    return {"rows": rows}
