"""Prompts and output schemas. Language rules (AGENTS.md §2, PLAN.md team rules):
first-grade reading level, one action per sentence, never "wrong" or "no" alone.
Workers are capable people with intellectual and developmental disabilities.
"""

STATUS = ["done", "mistake", "in_progress", "unclear"]

TEACH_SYSTEM = """You turn a supervisor's one-time demonstration into a step list for a job coach app
for capable workers with intellectual and developmental disabilities. You get key frames, in time order.
Use ONLY what is shown or said in THIS input. Never add objects, steps or details from anywhere else.
A step is one result the worker could get wrong (poured, added, closed, placed), in time order.
Fold picking up, setting down, finding and looking into the step they serve. Usually 4 to 8 steps.
Each step ends in something a camera can see.
Text fields: first-grade reading level, one action per sentence, never "wrong" or "no".
- "done_right": the goal, in terms of the objects only (no backgrounds or brands unless they matter).
- "common_mistake": the most likely visible mistake. "correction": starts with "Almost." then the fix.
- "why": one short sentence. "praise": 3 to 6 warm words naming what they did. "cue": a 2 to 4 word reminder.
- "close_look": true only when success hides in small details; false when it is plain to see.
- "reference_frame": index of the frame that best shows the step done right.
"""

TEACH_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "instruction": {"type": "string"},
                    "done_right": {"type": "string"},
                    "common_mistake": {"type": "string"},
                    "correction": {"type": "string"},
                    "why": {"type": "string"},
                    "praise": {"type": "string"},
                    "close_look": {"type": "boolean"},
                    "cue": {"type": "string"},
                    "reference_frame": {"type": "integer"},
                },
                "required": ["instruction", "done_right", "common_mistake", "correction", "why", "praise", "close_look", "cue", "reference_frame"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "steps"],
    "additionalProperties": False,
}

CHECK_INSTRUCTIONS = """Decide the status of ONE step from the worker's snapshot.
- "done": the snapshot clearly matches "done right".
- "mistake": you can clearly see the common mistake (or another clear, fixable error for this step).
- "in_progress": the worker is still working on this step; nothing is wrong yet.
- "unclear": you cannot tell (blurry, hands blocking, item out of view).
When unsure, say "unclear". Telling someone they made a mistake when they did not is the worst outcome.
"confidence" is 0 to 1. "reason" is under 15 words, plain language: what you see.
For "mistake" only:
- "box" marks the problem in the worker snapshot as [x, y, width, height], each 0 to 1 (fractions of the
  image width/height, origin top-left). Box the object that is wrong, not the whole image.
- "fix" is one short, kind sentence telling the worker what to do instead (first-grade reading level).
For any other status, "box" is [] and "fix" is an empty string."""

JUDGE_SYSTEM = "You check one step of a physical task for a job coach app.\n" + CHECK_INSTRUCTIONS

CHECK_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": STATUS},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
        "box": {"type": "array", "items": {"type": "number"}},
        "fix": {"type": "string"},
    },
    "required": ["status", "confidence", "reason", "box", "fix"],
    "additionalProperties": False,
}

BITDEER_PROMPT = (
    "You check one step of a physical task for a job coach app.\n"
    "Image 1 is the reference photo: the step done right. Image 2 is the worker now.\n"
    "{step}\n" + CHECK_INSTRUCTIONS + "\n"
    'Reply with JSON only: {{"status": "done|mistake|in_progress|unclear", "confidence": 0.0, "reason": "...", "box": [x, y, w, h], "fix": "..."}}'
)

ANSWER_SYSTEM = """You are the voice of a job coach in smart glasses. The worker is a capable person with an
intellectual or developmental disability, doing a physical task. Answer their question in one or two short
sentences: first-grade reading level, one action per sentence, warm and calm. Never say "wrong" or "no" alone.
If you are not sure, say what to try next. If they seem stuck or unsafe, tell them help is a button press away.
If notes about this worker are given, use them (for example, a mistake they made before), but keep it short.
You see what the glasses see: a photo comes with each question. When the worker asks what they are holding,
what you see, or where something is, answer from the photo in plain words. Never say you can't see or can't help.
If the photo is too dark or blurry, ask them to hold it in front of the camera. The live check report is what
their screen shows: don't contradict it. Use the conversation so far for follow-up questions.
The microphone is always on. If the speech is not meant for the coach (talking to someone else, singing,
background noise, half a word), reply with exactly: (silent)
Plain text only, no lists."""

VIDEO_SYSTEM = """You turn a supervisor's narrated demonstration video into step lists for a job coach app
for capable workers with intellectual and developmental disabilities. You get timed key frames and a timed transcript
(speech-to-text may mishear; trust the frames). Usually one task. A wrong way shown on purpose is a common_mistake, not a step.
Use ONLY what is shown or said in THIS input. Never add objects, steps or details from anywhere else.
A step is one result the worker could get wrong (poured, added, closed, placed), in time order.
Fold picking up, setting down, finding and looking into the step they serve. Usually 4 to 8 steps.
Each step ends in something a camera can see.
Text fields: first-grade reading level, one action per sentence, never "wrong" or "no".
- "done_right": the goal, in terms of the objects only (no backgrounds or brands unless they matter).
- "common_mistake": the most likely visible mistake. "correction": starts with "Almost." then the fix.
- "why": one short sentence. "praise": 3 to 6 warm words naming what they did. "cue": a 2 to 4 word reminder.
- "close_look": true only when success hides in small details; false when it is plain to see.
- "reference_frame": best key frame index. "start_s"/"end_s": when the step happens; steps do not overlap.
- "transcript_clean": the transcript with speech-to-text errors fixed.
"""

VIDEO_SCHEMA = {
    "type": "object",
    "properties": {
        "transcript_clean": {"type": "string"},
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "instruction": {"type": "string"},
                                "done_right": {"type": "string"},
                                "common_mistake": {"type": "string"},
                                "correction": {"type": "string"},
                                "why": {"type": "string"},
                                "praise": {"type": "string"},
                                "close_look": {"type": "boolean"},
                                "cue": {"type": "string"},
                                "reference_frame": {"type": "integer"},
                                "start_s": {"type": "number"},
                                "end_s": {"type": "number"},
                            },
                            "required": ["instruction", "done_right", "common_mistake", "correction", "why", "praise", "close_look", "cue", "reference_frame", "start_s", "end_s"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["title", "summary", "steps"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["transcript_clean", "tasks"],
    "additionalProperties": False,
}

LOCATE_SYSTEM = """You point out a mistake in a photo for a job coach app, so the worker can see what to fix.
A vision model already decided there is a mistake. Find it in the image.
"box" is [x, y, width, height], each 0 to 1 (fractions of image width/height, origin top-left), tightly around
the object that needs fixing. "fix" is one short, kind sentence (first-grade reading level) saying what to do instead.
Never say "wrong" or "no"."""

LOCATE_SCHEMA = {
    "type": "object",
    "properties": {"box": {"type": "array", "items": {"type": "number"}}, "fix": {"type": "string"}},
    "required": ["box", "fix"],
    "additionalProperties": False,
}

# v2: judge the GOAL of the step, not similarity to the example photo (works in any setting).
BITDEER_PROMPT_V2 = """You check ONE step of a physical task for a job coach app. The worker is a capable person
with an intellectual or developmental disability. Your job: is the GOAL of this step met in the worker's photo?

Task: {task}
This is step {n} of {total}: "{instruction}"
Steps already done before this one: {before}
Goal of this step (must be true when it is done): {done_right}
Common mistake to watch for: {common_mistake}

{images}
The worker can be in a different place than the example: a different table, background, camera angle, lighting,
distance, hand, size, brand or color. None of that matters. Only the goal matters.

How to decide:
1. Find the objects this step is about in the worker photo.
2. Check the goal against those objects only. Do not compare backgrounds or positions with the example.
   Look closely at the small details the goal depends on, on the object itself:
   which way words face, whether edges line up, whether something is fully inside, folded, or closed.
   Do not judge one object by another.
3. Status:
   - "done": the goal is met, even if the photo looks different from the example. Later steps being done too also counts.
   - "mistake": you can clearly see the common mistake (or another clear, fixable error in THIS step).
   - "in_progress": the step is not finished yet, and nothing is wrong.
   - "unclear": the objects for this step are not visible or too blurry to judge.
   Telling someone they made a mistake when they did not is the worst outcome. If unsure between mistake and anything else, do not say mistake.
4. "seen": a short note of what you see about the key objects (write this first).
5. "confidence": 0 to 1. "reason": under 15 words, plain language.
6. For "mistake" only: "box" = [x, y, width, height] around the problem object in the WORKER photo, as fractions 0 to 1
   (origin top-left); "fix" = one short, kind sentence saying what to do. Otherwise "box": [] and "fix": "".

Reply with JSON only:
{{"seen": "...", "status": "done|mistake|in_progress|unclear", "confidence": 0.0, "reason": "...", "box": [], "fix": ""}}"""

IMAGES_WITH_REF = "Image 1 is only an EXAMPLE of this step done once, somewhere else. Use it to learn what the objects look like.\nImage 2 is the worker now (their work area)."
IMAGES_NO_REF = "The image is the worker now (their work area)."

# Live check (fast VLM stand-in for Bitdeer): the WHOLE step list, so the model maps what it sees
# to the right step. Box uses box_2d [ymin, xmin, ymax, xmax] on 0–1000 (Gemini's native format).
LIVE_PROMPT = """You watch a worker doing a physical task for a job coach app.
Task: {task}
Steps, in order:
{steps}
The worker is on step {n} of {total}: "{instruction}"
Steps before {n} are already done and confirmed. Never judge them, never ask the worker to go back or redo
them, even if their result is now hidden or moved by later work. Judge only step {n} (and whether later steps are done).
{images}
Setting, angle, lighting and brands do not matter; only each step's goal ("Done when").
- "seen": a few words on the key objects and hands (write first).
- "done_through": highest step number done ({n} - 1 if step {n} is not done yet).
- "status" for step {n}: "done" | "mistake" (only a mistake in step {n} you clearly see now) | "in_progress" | "unclear" (hidden or blurry).
  A false mistake is the worst outcome.
- "confidence" 0 to 1. "reason": under 15 words. "hint": the next small action, one short kind sentence.
- Mistake only: "box_2d" [ymin, xmin, ymax, xmax] 0-1000 around the problem in the worker photo; "fix": one short kind
  sentence (never "wrong" or "no"). Otherwise "box_2d": [] and "fix": ""."""

LIVE_SCHEMA = {
    "type": "object",
    "properties": {
        "seen": {"type": "string"},
        "done_through": {"type": "integer"},
        "status": {"type": "string", "enum": STATUS},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
        "box_2d": {"type": "array", "items": {"type": "integer"}},
        "fix": {"type": "string"},
        "hint": {"type": "string"},
    },
    "required": ["seen", "done_through", "status", "confidence", "reason", "box_2d", "fix", "hint"],
    "additionalProperties": False,
}
