// Droid "re-teach engineer" runner (contract: docs/DROID.md, sections Sandbox + Runner).
// Usage: node droid/reteach.mjs <sandbox_dir>
// The edge builds the sandbox (AGENTS.md, validate.py, task.json, evidence.md). Droid runs at
// medium autonomy with cwd = sandbox and writes proposed.json. The RUNNER then re-runs validate.py
// itself (never trusts Droid's claim). One NDJSON event per line on stdout, also saved to
// <sandbox>/events.jsonl. Always exits 0; the last line is {"kind":"final",...}.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutonomyLevel, DroidMessageType, createSession } from '@factory/droid-sdk/node';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TIMEOUT_MS = 180_000;
const sandbox = process.argv[2] ? resolve(process.argv[2]) : '';
const eventsFile = sandbox ? join(sandbox, 'events.jsonl') : '';
const PY = existsSync(join(ROOT, '.venv', 'bin', 'python')) ? join(ROOT, '.venv', 'bin', 'python') : 'python3';

if (eventsFile && existsSync(sandbox)) writeFileSync(eventsFile, '');
function emit(obj) {
  const line = JSON.stringify(obj);
  process.stdout.write(line + '\n');
  if (eventsFile && existsSync(sandbox)) {
    try { appendFileSync(eventsFile, JSON.stringify({ ts: Date.now(), ...obj }) + '\n'); } catch {}
  }
}

let finalSent = false;
function final(ok, summary, steps = [], why = '', error = '') {
  if (finalSent) return;
  finalSent = true;
  emit({ kind: 'final', ok, summary, steps, why, error });
}

// Assistant text: merge streamed chunks and emit about one line per sentence-group / message.
let buf = '';
let planSent = false;
function flushText(force = false) {
  const t = buf.trim();
  if (!t) { buf = ''; return; }
  if (!force && !(t.length >= 60 && /[.!?:]$/.test(t))) return;
  emit({ kind: planSent ? 'text' : 'plan', text: t.slice(0, 2000) });
  planSent = true;
  buf = '';
}

async function main() {
  emit({ kind: 'status', text: 'running' });
  if (!sandbox || !existsSync(join(sandbox, 'task.json')) || !existsSync(join(sandbox, 'evidence.md'))) {
    emit({ kind: 'error', text: 'sandbox missing or incomplete (need task.json and evidence.md)' });
    return final(false, 'No sandbox.', [], '', 'bad sandbox');
  }
  try { process.loadEnvFile(join(ROOT, '.env')); } catch {} // values stay in process.env; never printed
  if (!process.env.FACTORY_API_KEY) {
    emit({ kind: 'error', text: 'FACTORY_API_KEY is not set' });
    return final(false, 'Droid is not configured.', [], '', 'FACTORY_API_KEY missing');
  }
  const local = join(homedir(), '.local', 'bin', 'droid');
  const execPath = existsSync(local) ? local : 'droid';

  const prompt = [
    'Read AGENTS.md first and follow it exactly.',
    'Then read evidence.md and task.json. evidence.md names the ONE step to improve.',
    'Write proposed.json with 1 or 2 replacement steps and a one-sentence "why".',
    'Do not edit any other file.',
    `Validate with: ${PY} validate.py`,
    'Fix proposed.json until it prints "validate: pass".',
    'Start your first message with a short plan (one or two sentences). End with a one-line summary.',
  ].join('\n');

  let session;
  let timedOut = false;
  let droidOk = false;
  let droidErr = '';
  let lastText = '';
  const timer = setTimeout(async () => {
    timedOut = true;
    emit({ kind: 'error', text: `timeout after ${TIMEOUT_MS / 1000} s` });
    try { await session?.close(); } catch {}
  }, TIMEOUT_MS);
  try {
    session = await createSession({ cwd: sandbox, execPath, autonomyLevel: AutonomyLevel.Medium });
    for await (const msg of session.stream(prompt)) {
      if (timedOut) break;
      if (msg.type === DroidMessageType.Assistant) {
        if (msg.text) { buf += msg.text; lastText = (lastText + msg.text).slice(-600); }
        flushText(false);
        continue;
      }
      flushText(true);
      switch (msg.type) {
        case DroidMessageType.ToolCall:
          lastText = '';
          emit({ kind: 'tool', text: String(msg.name ?? 'tool') });
          break;
        case DroidMessageType.ToolResult:
          emit({ kind: 'tool_result', text: msg.isError ? 'error' : 'ok' });
          break;
        case DroidMessageType.Error:
          emit({ kind: 'error', text: String(msg.message ?? 'error').slice(0, 500) });
          break;
        case DroidMessageType.Result:
          droidOk = !!msg.success;
          if (!msg.success) droidErr = String(msg.error?.message ?? 'session failed').slice(0, 300);
          break;
      }
    }
    flushText(true);
  } catch (e) {
    flushText(true);
    if (!timedOut) {
      droidErr = `${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 300)}`;
      emit({ kind: 'error', text: droidErr });
    }
  } finally {
    clearTimeout(timer);
    try { await session?.close(); } catch {}
  }

  if (timedOut) return final(false, 'Droid ran out of time.', [], '', 'timeout');

  // The runner validates the output itself.
  const v = spawnSync(PY, ['validate.py'], { cwd: sandbox, encoding: 'utf8', timeout: 20_000 });
  const out = ((v.stdout || '') + (v.stderr || '')).trim().split('\n').pop() || `validate: exit ${v.status}`;
  emit({ kind: 'check', text: out.slice(0, 500) });
  const passed = v.status === 0;

  let proposal = {};
  try { proposal = JSON.parse(readFileSync(join(sandbox, 'proposed.json'), 'utf8')); } catch {}
  const steps = Array.isArray(proposal.steps) ? proposal.steps : [];
  const why = typeof proposal.why === 'string' ? proposal.why : '';
  const summary = (lastText.trim().split('\n').filter(Boolean).pop() || why || '').slice(0, 300);
  if (!passed) return final(false, summary || 'Proposal did not pass validation.', steps, why, out);
  final(true, summary || why, steps, why, droidOk ? '' : droidErr);
}

main()
  .catch((e) => {
    emit({ kind: 'error', text: String(e?.message ?? e).slice(0, 500) });
    final(false, 'Runner crashed.', [], '', String(e?.message ?? e).slice(0, 300));
  })
  .finally(() => { process.exitCode = 0; setTimeout(() => process.exit(0), 200); });
