"""Prompts and output schemas. Language rules (AGENTS.md §2, PLAN.md team rules):
first-grade reading level, one action per sentence, never "wrong" or "no" alone.
Workers are capable people with intellectual and developmental disabilities.
"""

STATUS = ["done", "mistake", "in_progress", "unclear"]

TEACH_SYSTEM = """You turn a supervisor's one-time demonstration into a step list for a job coach app.
The app coaches capable workers with intellectual and developmental disabilities, step by step, using a camera.

You get key frames from the demo, in time order (moments the supervisor's hands paused between steps).
Write the steps the worker should follow, in order.
Use as FEW steps as possible: usually 2 to 4. Every step must end in a visible change to the objects that a
camera can check (picked up, turned, put on, folded). Never make a step that only looks, finds or checks
something: fold "find the cup" into "pick up the cup", and drop final "check that it is right" steps
(that check belongs in the step before, as its done_right). "instruction" is one or two short sentences.

Rules for every text field:
- First-grade reading level. Short, concrete words.
- One action per sentence.
- Never say "wrong" or "no". Corrections are kind and say exactly what to do.
- "done_right" describes the GOAL in terms of the objects, so a vision model can check it in ANY setting:
  no backgrounds, tables, brands, colors or positions unless they truly matter for the step.
- "common_mistake" is the most likely visible mistake for that step.
- "correction" is what to say when that mistake is seen. Start with "Almost." then the fix.
- "why" is one short sentence a worker can understand.
- "reference_frame" is the index of the frame that best shows the step done right.
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
                    "reference_frame": {"type": "integer"},
                },
                "required": ["instruction", "done_right", "common_mistake", "correction", "why", "reference_frame"],
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
Plain text only, no lists."""

VIDEO_SYSTEM = """You turn a supervisor's narrated demonstration video into step lists for a job coach app.
The app coaches capable workers with intellectual and developmental disabilities, step by step, using a camera
and a voice. You get key frames from the video (with their times) and the speech-to-text transcript (with times).
Speech-to-text can mishear words; use the frames to understand what was really meant.

Break the video into tasks (usually one), each with ordered steps the worker should follow.
Use as FEW steps as possible: usually 2 to 4. Every step must end in a visible change to the objects that a
camera can check (picked up, turned, put on, folded). Never make a step that only looks, finds or checks
something: fold "find the cup" into "pick up the cup", and drop final "check that it is right" steps
(that check belongs in the step before, as its done_right). "instruction" is one or two short sentences.
If the supervisor demonstrates a wrong way on purpose, do NOT make it a step: use it as that step's common_mistake
and correction.

Rules for every text field:
- First-grade reading level. Short, concrete words. One action per sentence.
- Never say "wrong" or "no". Corrections are kind and say exactly what to do. Start corrections with "Almost."
- "done_right" describes the GOAL in terms of the objects, so a vision model can check it in ANY setting:
  no backgrounds, tables, brands, colors or positions unless they truly matter for the step.
- "why" is one short sentence a worker can understand.
- "reference_frame" is the index of the key frame that best shows the step done right.
- "start_s" and "end_s" are the times in the video where the step happens.
- "transcript_clean" is the transcript with obvious speech-to-text errors fixed (keep the supervisor's words).
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
                                "reference_frame": {"type": "integer"},
                                "start_s": {"type": "number"},
                                "end_s": {"type": "number"},
                            },
                            "required": ["instruction", "done_right", "common_mistake", "correction", "why", "reference_frame", "start_s", "end_s"],
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
distance, hand, cup size, brand or color. None of that matters. Only the goal matters.

How to decide:
1. Find the objects this step is about in the worker photo.
2. Check the goal against those objects only. Do not compare backgrounds or positions with the example.
   Look closely at the small details the goal depends on, on the object itself: for example which way printed
   words or letters face (read them), whether edges line up, whether something is fully inside, folded, or closed.
   Do not judge one object by another (a logo on a cup being upright says nothing about the sleeve's words).
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
LIVE_PROMPT = """You watch a worker doing a physical task, for a job coach app. The worker is a capable person
with an intellectual or developmental disability. Look at the worker photo and decide how far along they are.

Task: {task}
All steps, in order:
{steps}

The app thinks the worker is on step {n} of {total}: "{instruction}"

{images}
The worker can be in a different place than the example: different table, background, camera angle, lighting,
hand, size, brand or color. None of that matters. Only whether each step's goal ("Done when") is met matters.

Answer:
- "seen": a few words on the key objects and what the hands are doing (write this first).
- "done_through": the highest step number whose goal is clearly met right now (0 if none).
  If the worker has clearly moved on to a later step, the steps before it count as met.
- "status" for step {n}:
  "done" = its goal is met (also when later steps are done);
  "mistake" = you can clearly see its common mistake or another clear, fixable error in this step;
  "in_progress" = not finished yet and nothing is wrong;
  "unclear" = the objects are hidden or too blurry to judge.
  Telling someone they made a mistake when they did not is the worst outcome. If unsure, do not say mistake.
- "confidence": 0 to 1. "reason": under 15 words, plain language.
- For "mistake" only: "box_2d" = [ymin, xmin, ymax, xmax] around the problem object in the WORKER photo,
  scaled 0 to 1000; "fix" = one short, kind sentence saying what to do (first-grade reading level, never
  "wrong" or "no"). Otherwise "box_2d": [] and "fix": ""."""

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
    },
    "required": ["seen", "done_through", "status", "confidence", "reason", "box_2d", "fix"],
    "additionalProperties": False,
}
