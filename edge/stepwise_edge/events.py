"""Thread-safe event bus: the camera pipeline thread publishes, WebSocket clients subscribe."""
from __future__ import annotations

import asyncio
import collections
import time


class EventBus:
    def __init__(self, history: int = 50) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subs: set[asyncio.Queue] = set()
        self.recent: collections.deque = collections.deque(maxlen=history)

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def publish(self, type_: str, **data) -> dict:
        """Callable from any thread. Never blocks the caller."""
        event = {"type": type_, "ts": time.time(), **data}
        self.recent.append(event)
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._fanout, event)
        return event

    def _fanout(self, event: dict) -> None:
        for q in list(self._subs):
            if q.full():
                q.get_nowait()  # drop the oldest for a slow client
            q.put_nowait(event)
