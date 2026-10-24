"""Kill-test 7: Moss index create → load once → 100 in-process queries.

Indexes a handful of the coach's own phrasings for the amenity tray task
(guidance_<worker> shape from AGENTS.md §7), loads the index once (the only
network call), then times 100 queries with the index preloaded.
Pass: p99 < 10 ms and the scripted questions retrieve the right step.
"""
import asyncio
import time

from moss import DocumentInfo, MossClient, QueryOptions

from common import env, pctl, record

INDEX = "killtest_guidance_jordan"
DOCS = [
    ("s1_full", "s1", "Pick up the blue soap. Put it in the top-left slot."),
    ("s1_cue", "s1", "Soap, top left."),
    ("s1_fix", "s1", "Almost. The soap goes in the top-left slot."),
    ("s2_full", "s2", "Pick up the green shampoo. Put it in the top-right slot."),
    ("s2_cue", "s2", "Shampoo, top right."),
    ("s3_full", "s3", "Pick up the yellow lotion. Put it in the bottom-left slot."),
    ("s3_cue", "s3", "Lotion goes bottom left. Yellow bottle."),
    ("s3_fix", "s3", "Almost. Use the yellow bottle. That one is the lotion."),
    ("s4_full", "s4", "Fold the white washcloth in half. Put it in the bottom-right slot."),
    ("s4_fix", "s4", "Almost. Fold the cloth one more time."),
    ("s5_full", "s5", "Slide the tray to the done mark."),
    ("help_1", "s4", "Sam showed how to fold it in half, corners together."),
]
# (question, expected step) — the worker's own words
QUESTIONS = [
    ("where does the lotion go", "s3"),
    ("what do I do with the soap", "s1"),
    ("how do I fold the towel", "s4"),
    ("which bottle is the shampoo", "s2"),
    ("I'm done, where does the tray go", "s5"),
]


async def main() -> int:
    t: dict[str, float] = {}
    client = MossClient(env("MOSS_PROJECT_ID"), env("MOSS_PROJECT_KEY"))
    docs = [DocumentInfo(id=i, text=txt, metadata={"step_id": s}) for i, s, txt in DOCS]

    try:
        existing = {ix.name for ix in await client.list_indexes()}
        if INDEX in existing:
            await client.delete_index(INDEX)
        t0 = time.perf_counter()
        await client.create_index(INDEX, docs, "moss-minilm")
        t["create_index"] = (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        await client.load_index(INDEX)  # the only network call
        t["load_index"] = (time.perf_counter() - t0) * 1000
    except Exception as e:
        return record("moss", "fail", f"create/load failed: {type(e).__name__}: {str(e)[:160]}", t)

    opts = QueryOptions(top_k=3)
    for q, _ in QUESTIONS:  # warm-up
        await client.query(INDEX, q, opts)

    lat = []
    hits = 0
    answers = {}
    for i in range(100):
        q, want = QUESTIONS[i % len(QUESTIONS)]
        t0 = time.perf_counter()
        res = await client.query(INDEX, q, opts)
        lat.append((time.perf_counter() - t0) * 1000)
        top = res.docs[0] if res.docs else None
        got = (top.metadata or {}).get("step_id") if top else None
        if i < len(QUESTIONS):
            answers[q] = {"step": got, "text": top.text if top else None, "score": round(top.score, 3) if top else None}
            hits += got == want

    # Metadata filter path used by the worker-question flow (AGENTS.md §7)
    f = QueryOptions(top_k=3, filter={"field": "step_id", "condition": {"$eq": "s3"}})
    fres = await client.query(INDEX, "what now", f)
    filter_ok = bool(fres.docs) and all((d.metadata or {}).get("step_id") == "s3" for d in fres.docs)

    t["query_p50"] = pctl(lat, 50)
    t["query_p99"] = pctl(lat, 99)
    await client.close()

    extra = {"answers": answers, "filter_ok": filter_ok, "queries": len(lat), "index": INDEX}
    detail = f"100 queries p50 {t['query_p50']:.2f} ms / p99 {t['query_p99']:.2f} ms; {hits}/{len(QUESTIONS)} scripted questions → right step; filter {'OK' if filter_ok else 'BAD'}"
    ok = t["query_p99"] < 10 and hits >= len(QUESTIONS) - 1 and filter_ok
    return record("moss", "pass" if ok else "partial", detail, t, extra)


raise SystemExit(asyncio.run(main()))
