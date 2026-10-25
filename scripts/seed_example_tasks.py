"""Seed 3 example Café tasks so the worker home has real cards under "My tasks".

Idempotent: same task ids every run; re-running rewrites the steps and keeps the creation time.
No step photos and no cover photo (the founder sends real first-person photos later), so the cards
show the clean placeholder.

Run: .venv/bin/python scripts/seed_example_tasks.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "edge"))

from stepwise_edge.config import ROOT, load_config  # noqa: E402
from stepwise_edge.stdb import Stdb  # noqa: E402
from stepwise_edge.tasks import TaskStore  # noqa: E402


def step(instruction, done_right, common_mistake, correction, why, praise, cue, close_look=False):
    return dict(instruction=instruction, done_right=done_right, common_mistake=common_mistake, correction=correction,
                why=why, praise=praise, cue=cue, reference_photo="", close_look=close_look)


EXAMPLES = [
    {
        "task_id": "example_clean_coffee_machine", "title": "Clean the coffee machine", "place": "Café", "minutes": 5,
        "summary": "Wipe the machine. Rinse the portafilter. Clean the steam wand. Empty the drip tray.",
        "steps": [
            step("Take the portafilter out of the machine. Knock out the old coffee into the bin.", "The portafilter is out and the basket is empty.",
                 "Old coffee is still in the basket.", "Almost. Knock the portafilter on the bin until the coffee is out.",
                 "Old coffee makes the next shot taste bad.", "Empty and ready!", "Empty the portafilter"),
            step("Rinse the portafilter under the tap. Dry it with a clean cloth.", "The portafilter is clean and dry.",
                 "Coffee bits are still stuck on the basket.", "Almost. Rinse it again. Wipe the basket with the cloth.",
                 "A clean basket keeps the coffee fresh.", "Nice and clean!", "Rinse and dry", True),
            step("Wipe the steam wand with the damp cloth. Turn the steam on for a second.", "The wand is shiny with no milk on it.",
                 "Dried milk is still on the steam wand.", "Almost. Wipe the wand again. Then let out a little steam.",
                 "Dried milk can block the wand.", "Clean wand!", "Wipe the wand"),
            step("Pull out the drip tray. Empty it in the sink. Rinse it.", "The drip tray is empty and clean.",
                 "The drip tray is put back with water in it.", "Almost. Empty the water in the sink. Then put the tray back.",
                 "A full tray can spill on the counter.", "The tray is clean!", "Empty the tray"),
            step("Wipe the top and front of the machine with the cloth.", "The machine looks clean and dry.",
                 "Coffee drips are still on the front.", "Almost. Wipe the front once more.",
                 "A clean machine looks good for customers.", "The machine is clean. Great job!", "Wipe the machine", True),
        ],
    },
    {
        "task_id": "example_venti_americano", "title": "Make a venti americano", "place": "Café", "minutes": 4,
        "summary": "Get a venti cup. Pull two shots. Add hot water. Put on the lid.",
        "steps": [
            step("Take a large venti cup. Put it on the counter.", "A large venti cup is on the counter.",
                 "A small cup is used.", "Almost. Take the big venti cup.",
                 "A venti drink needs the big cup.", "Right cup!", "Get a venti cup"),
            step("Pull two espresso shots into a small cup.", "Two dark shots are in the small cup.",
                 "Only one shot is pulled.", "Almost. Pull one more shot. A venti needs two.",
                 "Two shots give the right taste.", "Two shots. Nice!", "Pull two shots"),
            step("Pour the shots into the venti cup.", "The espresso is in the venti cup.",
                 "Espresso is spilled on the counter.", "Almost. Pour slowly into the cup.",
                 "Slow pouring keeps the counter clean.", "Poured neatly!", "Shots into the cup"),
            step("Add hot water up to the line on the cup.", "Hot water fills the cup to the line.",
                 "The cup is filled to the top.", "Almost. Stop the water at the line.",
                 "Too much water makes the coffee weak.", "Just right!", "Water to the line", True),
            step("Press the lid on the cup until it clicks.", "The lid is on and closed all around.",
                 "The lid sits on top but is not pressed down.", "Almost. Press the lid down all around until it clicks.",
                 "A loose lid can spill.", "Your americano is ready!", "Lid on"),
        ],
    },
    {
        "task_id": "example_strawberry_matcha", "title": "Make a strawberry matcha", "place": "Café", "minutes": 5,
        "summary": "Add strawberry. Add ice and milk. Mix the matcha. Pour it on top.",
        "steps": [
            step("Put two scoops of strawberry puree in the bottom of the cup.", "Red strawberry puree is at the bottom of the cup.",
                 "Only a little puree is in the cup.", "Almost. Add one more scoop of strawberry puree.",
                 "The puree gives the drink its sweet taste.", "Nice and red!", "Add strawberry"),
            step("Fill the cup with ice. Pour cold milk over the ice.", "The cup has ice and white milk on top of the puree.",
                 "The milk is poured before the ice.", "Almost. Put the ice in first. Then the milk.",
                 "Ice first keeps the layers neat.", "Good layers!", "Ice, then milk", True),
            step("Whisk the matcha with warm water in a small cup until smooth.", "The matcha is green and smooth with no lumps.",
                 "Green lumps are floating in the cup.", "Almost. Whisk a little longer until it is smooth.",
                 "Lumps taste bitter.", "Smooth matcha!", "Whisk the matcha"),
            step("Pour the matcha slowly over the milk.", "A green layer sits on top of the white milk.",
                 "The matcha is poured too fast and mixes in.", "Almost. Pour slower so the green stays on top.",
                 "A slow pour makes a pretty drink.", "Pretty layers!", "Matcha on top", True),
            step("Put on the lid and a straw. Hand the drink to the customer.", "The lid and straw are on.",
                 "The straw is missing.", "Almost. Put a straw in the lid.",
                 "The customer needs a straw to drink it.", "Your matcha is ready!", "Lid and straw"),
        ],
    },
]


def main() -> None:
    store = TaskStore(ROOT / "data")
    try:
        db = Stdb(load_config(), ROOT / "data" / "stdb_identity.json")
    except Exception as e:  # the files still seed; the supervisor floor just won't list them yet
        db, err = None, e
    for ex in EXAMPLES:
        old = store.get(ex["task_id"]) or {}
        steps = [{"id": i + 1, **s} for i, s in enumerate(ex["steps"])]
        task = {**old, **ex, "steps": steps, "frames": [], "saved": True, "example": True,
                "created_at": old.get("created_at", time.time())}
        store.save(task)
        if db:
            ok, msg = db.call_sync("save_task", task["task_id"], task["title"], json.dumps(steps))
            print(f"{task['task_id']}: {len(steps)} steps, SpacetimeDB {'ok' if ok else 'failed: ' + msg}")
        else:
            print(f"{task['task_id']}: {len(steps)} steps, SpacetimeDB unavailable: {type(err).__name__}")


if __name__ == "__main__":
    main()
