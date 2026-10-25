"""A worker's first Moss load (a cloud call) must not hold up the step: recall gives up after wait_s
with no memories, and the load finishes in the background so the next recall is instant."""
import asyncio
import time

from stepwise_edge.memory import Memory


class FakeSession:
    doc_count = 0


def test_slow_first_load_gives_up_then_finishes_in_background(tmp_path):
    async def run():
        m = Memory(tmp_path)
        loads = []

        async def slow_session(worker_id):
            if not loads:
                loads.append(1)
                await asyncio.sleep(0.3)  # the cloud load
                m._sessions["x"] = FakeSession()
            return m._sessions["x"], "x"

        m._session = slow_session
        t0 = time.perf_counter()
        mems, _ = await m.recall("w", "q", wait_s=0.05)
        assert mems == [] and time.perf_counter() - t0 < 0.2
        await asyncio.sleep(0.4)  # background load done
        t1 = time.perf_counter()
        mems, _ = await m.recall("w", "q", wait_s=0.05)
        assert mems == [] and time.perf_counter() - t1 < 0.05
        assert loads == [1]  # loaded once, not restarted

    asyncio.run(run())
