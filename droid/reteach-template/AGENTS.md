# Droid rules: re-teach ONE step

You improve ONE step of a job task for a worker with an intellectual or developmental disability.
The worker is a capable person who needs clear, kind support.

## Inputs (read both first; do not edit them)
- `task.json` — the whole task. The step to fix is named in `evidence.md`.
- `evidence.md` — what went wrong on that step: corrections spoken, reasons seen, help requests, memory notes.

## Output: write `proposed.json` (the only file you may create or edit)
```json
{ "steps": [ { "instruction": "...", "done_right": "...", "common_mistake": "...",
               "correction": "Almost. ...", "why": "...", "praise": "...",
               "cue": "2-4 words", "close_look": true } ],
  "why": "One sentence: what you changed and why." }
```
- `steps`: 1 or 2 steps that REPLACE the target step. Use 2 only to split a step that hides two actions.
- Every field is a non-empty string, except `close_look` (true or false).

## Writing rules
- First-grade reading level. One action per sentence. At most 14 words per sentence.
- `instruction`: at most 2 sentences. `cue`: 2-4 words.
- `correction` starts with "Almost." and names the exact fix.
- Never say "wrong" or "no" alone. Be warm.
- No names of people. Say "you". No URLs, no HTML.

## Fix what the evidence shows
- A step hides two actions → split it into two steps.
- The same correction keeps being spoken → make the instruction prevent that mistake, and make the
  correction name the exact fix.
- Success is in small details (which way words face, which side is up) → `close_look: true`.
- A memory note gives a tip → put the tip into the instruction (e.g. "Check the words face out.").

## Rules of the sandbox
- Do not edit `task.json`, `evidence.md`, `AGENTS.md`, `validate.py` or any other file.
- Run `python3 validate.py` (or the python path given in the prompt). Fix `proposed.json` until it prints
  `validate: pass`.
- Then stop with a one-line summary.
