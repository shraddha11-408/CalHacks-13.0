"""Config + env loading. Secrets come only from .env and are never logged."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "config.yaml"
load_dotenv(ROOT / ".env")

# cvlib lives at the repo root, not installed as a package
if str(ROOT / "cvlib") not in sys.path:
    sys.path.insert(0, str(ROOT / "cvlib"))


def load_config() -> dict:
    return yaml.safe_load(CONFIG_PATH.read_text())


def save_hsv(item: str, lo: list[int], hi: list[int]) -> dict:
    """Update one item in the `hsv:` block of config.yaml, keeping every other line (and comment)."""
    text = CONFIG_PATH.read_text()
    cfg = yaml.safe_load(text)
    hsv = dict(cfg.get("hsv") or {})
    hsv[item] = {"lo": [int(x) for x in lo], "hi": [int(x) for x in hi]}
    lines = ["hsv:"]
    for name, rng in hsv.items():
        lines += [f"  {name}:", f"    lo: [{', '.join(map(str, rng['lo']))}]", f"    hi: [{', '.join(map(str, rng['hi']))}]"]
    block = "\n".join(lines) + "\n"
    # Replace from the top-level `hsv:` key to the next top-level key (or EOF).
    pattern = re.compile(r"^hsv:\n(?:(?:[ \t].*|)\n)*", re.M)
    if pattern.search(text):
        text = pattern.sub(block, text, count=1)
    else:
        text = text.rstrip() + "\n\n" + block
    CONFIG_PATH.write_text(text)
    return hsv
