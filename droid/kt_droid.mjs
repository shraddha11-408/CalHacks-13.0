// Kill-test 6: one Droid session in a copied sandbox folder, streaming events.
// The sandbox is a plain copy of checker-template/ + cvlib/ (AGENTS.md §5
// deviation: no git worktree). Medium autonomy: Droid may edit files and run
// tests inside the sandbox. Every event is printed and saved to JSONL.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutonomyLevel, DroidMessageType, createSession } from '@factory/droid-sdk/node';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RESULTS = join(ROOT, 'scripts', 'killtests', 'results.json');
const OUT = join(ROOT, 'scripts', 'killtests', 'out');
mkdirSync(OUT, { recursive: true });

process.loadEnvFile(join(ROOT, '.env')); // values stay in process.env; never printed

function record(status, detail, timings = {}, extra = {}) {
  const data = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};
  data.droid = {
    status,
    detail,
    timings_ms: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    extra,
    ran_at: new Date().toLocaleString('sv-SE'), // local time, YYYY-MM-DD HH:MM:SS
  };
  writeFileSync(RESULTS, JSON.stringify(data, null, 2));
  console.log(`[${status.toUpperCase()}] droid: ${detail}`);
  process.exitCode = status === 'pass' ? 0 : 1;
}

if (!process.env.FACTORY_API_KEY) {
  record('fail', 'FACTORY_API_KEY is empty in .env');
  process.exit();
}
const execPath = [join(homedir(), '.local', 'bin', 'droid'), 'droid'].find((p) => p === 'droid' || existsSync(p));

// --- sandbox: plain copied folder per job ---
const jobId = `killtest-${Date.now()}`;
const sandbox = join(HERE, 'sandboxes', jobId);
cpSync(join(HERE, 'checker-template'), sandbox, { recursive: true });
cpSync(join(ROOT, 'cvlib', 'cvlib'), join(sandbox, 'cvlib'), { recursive: true });
const PY = join(ROOT, '.venv', 'bin', 'python');
const eventsFile = join(OUT, `droid_events_${jobId}.jsonl`);

const prompt = [
  'Read AGENTS.md first and follow it.',
  'Task (kill-test, keep it tiny): create checkers/always_unclear.py with',
  'check(rectified, ref) that returns {"status": "not_done", "error_type": None, "confidence": 0.0}',
  'when the image is all black, else {"status": "done", "error_type": None, "confidence": 0.5}.',
  'Also create tests/test_always_unclear.py with two pytest tests (black image, white image) using numpy.',
  `Run the tests with: ${PY} -m pytest -q tests`,
  'Then stop and give a one-line summary.',
].join('\n');

const t = {};
const counts = {};
const t0 = performance.now();
let firstEvent;
let session;
try {
  session = await createSession({ cwd: sandbox, execPath, autonomyLevel: AutonomyLevel.Medium });
  t.session_start = performance.now() - t0;
  let ok = false;
  let summary = '';
  for await (const msg of session.stream(prompt)) {
    firstEvent ??= performance.now() - t0;
    counts[msg.type] = (counts[msg.type] ?? 0) + 1;
    const line = { ts: Date.now(), type: msg.type };
    switch (msg.type) {
      case DroidMessageType.Assistant:
        process.stdout.write(msg.text);
        summary += msg.text;
        line.text = msg.text;
        break;
      case DroidMessageType.ToolCall:
        console.log(`\n[tool] ${msg.name}`);
        line.name = msg.name;
        break;
      case DroidMessageType.ToolResult:
        console.log(`[tool result] ${msg.isError ? 'error' : 'ok'}`);
        line.isError = msg.isError;
        break;
      case DroidMessageType.Error:
        console.error(`\n[error] ${msg.message}`);
        line.message = msg.message;
        break;
      case DroidMessageType.Result:
        ok = msg.success;
        line.success = msg.success;
        line.tokenUsage = msg.tokenUsage;
        if (!msg.success) line.error = msg.error?.message;
        break;
    }
    appendFileSync(eventsFile, JSON.stringify(line) + '\n');
  }
  t.first_event = firstEvent ?? 0;
  t.total = performance.now() - t0;

  // The runner (never Droid) verifies the output by running the tests itself.
  const { spawnSync } = await import('node:child_process');
  const verify = spawnSync(PY, ['-m', 'pytest', '-q', 'tests'], { cwd: sandbox, encoding: 'utf8' });
  const passed = verify.status === 0;
  const fileOk = existsSync(join(sandbox, 'checkers', 'always_unclear.py'));
  const extra = { job_id: jobId, sandbox: `droid/sandboxes/${jobId}`, event_counts: counts, runner_pytest: verify.stdout.trim().split('\n').pop(), events_file: eventsFile.replace(ROOT + '/', '') };
  const detail = `session ${ok ? 'completed' : 'did not complete'}; ${Object.values(counts).reduce((a, b) => a + b, 0)} events streamed (${counts[DroidMessageType.ToolCall] ?? 0} tool calls); runner re-ran tests: ${passed ? 'pass' : 'FAIL'}`;
  record(ok && passed && fileOk ? 'pass' : 'partial', detail, t, extra);
} catch (e) {
  t.total = performance.now() - t0;
  record('fail', `Droid session failed: ${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 180)}`, t, { job_id: jobId, event_counts: counts });
} finally {
  await session?.close();
}
