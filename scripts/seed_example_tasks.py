"""Seed 4 example tasks (Café / Store / Stockroom) so the worker home has real cards to show.

Idempotent: same task ids every run; re-running rewrites the steps and keeps the creation time.
Step photos are left empty on purpose (the founder sends real first-person photos later); each task
has a `cover_photo` from web/public/media where one already exists.

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
        "task_id": "example_espresso_shot", "title": "Make an espresso shot", "place": "Café", "minutes": 3,
        "cover_photo": "/media/cafe-espresso.jpg",
        "summary": "Grind the coffee. Press it flat. Lock it in. Pull the shot.",
        "steps": [
            step("Hold the portafilter under the grinder. Press the grind button.", "Ground coffee fills the basket of the portafilter.",
                 "The portafilter is not under the grinder, so coffee spills.", "Almost. Hold the portafilter right under the grinder. Then press the button.",
                 "The coffee needs to land in the basket.", "Nice grinding!", "Grind the coffee"),
            step("Put the portafilter on the counter. Press the tamper down hard and flat.", "The coffee is pressed flat and smooth in the basket.",
                 "The coffee is pressed at a tilt, higher on one side.", "Almost. Hold the tamper straight. Press down flat again.",
                 "Flat coffee makes a good, even shot.", "That is nice and flat!", "Tamp it flat", True),
            step("Push the portafilter up into the machine. Turn the handle to the right until it stops.", "The portafilter is locked in. The handle points to the front.",
                 "The handle is only turned a little, so it is loose.", "Almost. Keep turning the handle to the right until it stops.",
                 "A loose portafilter can leak hot water.", "Locked in!", "Lock it in"),
            step("Put a small white cup under the spout.", "A small cup sits right under the spout.",
                 "The cup is off to the side of the spout.", "Almost. Slide the cup so it is right under the spout.",
                 "The espresso needs to fall into the cup.", "Good, the cup is ready.", "Cup under the spout"),
            step("Press the shot button. Wait until the coffee stops.", "Dark espresso is in the cup and the pour has stopped.",
                 "The cup is taken away while coffee is still pouring.", "Almost. Leave the cup there. Wait until the coffee stops.",
                 "The full shot makes the drink taste right.", "You made an espresso shot!", "Pull the shot"),
        ],
    },
    {
        "task_id": "example_pour_latte", "title": "Pour a latte", "place": "Café", "minutes": 4,
        "cover_photo": "/media/cafe-latte.jpg",
        "summary": "Fill the pitcher. Steam the milk. Pour it into the espresso.",
        "steps": [
            step("Pour cold milk into the metal pitcher. Stop at the line inside.", "Milk is in the pitcher up to the line.",
                 "The pitcher is filled to the top.", "Almost. Pour a little milk out. Stop at the line.",
                 "Milk grows when it steams. Too much will spill.", "Just the right amount!", "Milk to the line", True),
            step("Put the steam wand in the milk. Turn the steam on.", "The wand tip is just under the milk and steam is on.",
                 "The wand tip is above the milk, so it sprays.", "Almost. Lower the pitcher a little so the tip is in the milk.",
                 "The tip in the milk makes smooth foam.", "Nice steaming!", "Wand in the milk"),
            step("When the pitcher feels hot, turn the steam off. Wipe the wand with the cloth.", "The steam is off and the wand is wiped clean.",
                 "The wand is not wiped after steaming.", "Almost. Take the cloth. Wipe the steam wand.",
                 "Dried milk makes the wand dirty.", "Clean wand. Good job!", "Steam off, wipe"),
            step("Tilt the cup. Pour the milk slowly into the middle of the espresso.", "Milk and foam fill the cup. The top is smooth.",
                 "The milk is poured too fast and spills over.", "Almost. Pour slower. Keep the pour in the middle.",
                 "A slow pour keeps the drink neat.", "You poured a latte!", "Pour slow"),
        ],
    },
    {
        "task_id": "example_restock_shampoo", "title": "Restock shampoo on the shelf", "place": "Store", "minutes": 6,
        "cover_photo": "/media/retail-shelf.jpg",
        "summary": "Bring the box to the aisle. Put bottles on the shelf. Labels face out. Make the front neat.",
        "steps": [
            step("Put the shampoo box on the cart. Push the cart to the shampoo aisle.", "The cart with the shampoo box is in the shampoo aisle.",
                 "The cart is in a different aisle.", "Almost. Look at the aisle sign. Go to the shampoo aisle.",
                 "Shoppers look for shampoo in its own aisle.", "You found the aisle!", "Cart to the aisle"),
            step("Find the shampoo spot on the shelf. Match the bottle to the shelf tag.", "You are at the shelf tag that matches the bottle.",
                 "The bottles go to a spot with a different tag.", "Almost. Look at the shelf tag. Find the one that matches the bottle.",
                 "The right spot helps shoppers find it.", "That is the right spot!", "Match the tag", True),
            step("Move the old bottles to the front. Put the new bottles behind them.", "Old bottles are in front. New bottles are in the back.",
                 "New bottles are put in front of the old ones.", "Almost. Move the old bottles to the front first. New ones go behind.",
                 "Old bottles get sold first.", "Old ones in front. Nice!", "Old ones in front"),
            step("Turn every bottle so the label faces out.", "Every label faces out to the aisle.",
                 "Some bottles face sideways or backward.", "Almost. Turn those bottles so the label faces you.",
                 "Shoppers read the label to choose.", "All the labels face out!", "Labels face out", True),
            step("Pull the bottles to the front edge of the shelf. Make the row straight.", "The bottles are lined up at the front edge.",
                 "The bottles are pushed to the back of the shelf.", "Almost. Pull the bottles up to the front edge.",
                 "A full, neat front looks ready for shoppers.", "The shelf looks great!", "Front the shelf"),
        ],
    },
    {
        "task_id": "example_stockroom_box", "title": "Put a box away in the stockroom", "place": "Stockroom", "minutes": 3,
        "cover_photo": "/media/backroom-box.jpg",
        "summary": "Read the box. Find its shelf. Lift with your legs. Label out.",
        "steps": [
            step("Read the label on the box. Say what is inside.", "You can see the box label and read it.",
                 "The box is turned so the label is hidden.", "Almost. Turn the box so you can see the label.",
                 "The label tells you where the box goes.", "Good reading!", "Read the label"),
            step("Find the shelf sign that matches the box.", "You are at the shelf with the matching sign.",
                 "You are at a shelf with a different sign.", "Almost. Look at the sign again. Find the one that matches the box.",
                 "Boxes in the right place are easy to find.", "That is the right shelf!", "Find the shelf", True),
            step("Bend your knees. Hold the box with two hands. Lift it up.", "You hold the box with two hands, close to your body.",
                 "The box is lifted with one hand.", "Almost. Use two hands. Keep the box close to you.",
                 "Two hands keep you safe and the box steady.", "Safe lift!", "Two hands, lift"),
            step("Slide the box onto the shelf. Turn it so the label faces out.", "The box is on the shelf. The label faces out.",
                 "The box sits with the label facing the wall.", "Almost. Turn the box so the label faces you.",
                 "Coworkers read the label to find it fast.", "All put away. Great job!", "Label out", True),
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
