"""Print results.json as a pass/fail table."""
import json

from common import RESULTS

ORDER = ["camera", "aruco", "bitdeer", "cartesia", "spacetime", "droid", "moss"]
data = json.loads(RESULTS.read_text()) if RESULTS.exists() else {}
print(f"\n{'test':10} {'status':8} timings / detail")
for k in ORDER:
    r = data.get(k)
    if not r:
        print(f"{k:10} {'not run':8}")
        continue
    t = ", ".join(f"{a}={b}ms" for a, b in r["timings_ms"].items())
    print(f"{k:10} {r['status'].upper():8} {t}\n{'':19}{r['detail']}")
