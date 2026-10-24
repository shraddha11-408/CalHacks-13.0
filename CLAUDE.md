# Stepwise — Claude Code instructions
@AGENTS.md

AGENTS.md is the source of truth. Read it fully before your first edit in any session.

## Working rules
- Work in phases. Plan briefly, then build, run, test what you can yourself, fix errors,
  and end with a short checklist of exactly what I should look at to confirm it works.
- Do not commit or push anything to git until I explicitly ask.
- Secrets only in .env. Never print, log or commit keys.
- Look up current official docs (Anthropic, Bitdeer, Cartesia, SpacetimeDB, Factory Droid
  SDK, Moss, OpenCV ArUco, Picamera2, Arduino Uno Q, XVF3800) before writing integration
  code. Don't guess APIs.
- Droid sandboxes: use a plain copied folder per compile job instead of a git worktree
  (we avoid git operations; note this deviation in AGENTS.md section 5).
- Until the glasses hardware is ready, the laptop webcam, laptop mic and laptop speaker
  stand in. Every device sits behind an interface chosen in config.yaml.
- When I need to do something by hand (keys, logins, permissions, hardware), tell me the
  exact step and stop until I confirm.
