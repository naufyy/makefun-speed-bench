// bench.mjs — dependency-free benchmark runner for make.fun speed-comp entries.
//
// For every entry under entries/, it runs the entry's main.ts on the practice workload
// (practice/input/cases.json) for N interleaved rounds, pinned to one CPU (taskset -c 0),
// measuring TOTAL CPU (user + sys, all threads) per run with tools/cpuhook.mjs — the same
// accounting as the local workbench's bench.sh. Entry order rotates every round so slow
// machine drift hits every entry alike.
//
// Every non-null entry's answers.json must byte-equal the expected practice answers
// (derived from practice/reference/expected.json); the null control's output must at
// least be a JSON array with one answer per case. Any mismatch or failed run makes the
// runner exit non-zero, after writing the report.
//
// Usage: node bench.mjs [--rounds 15] [--label <report-name>]
// The Markdown report lands in results/ and is also printed to stdout.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, cpus, platform, arch, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const ENTRIES_DIR = join(ROOT, 'entries');
const INPUT_DIR = join(ROOT, 'practice', 'input');
const EXPECTED_PATH = join(ROOT, 'practice', 'reference', 'expected.json');
const HOOK = join(ROOT, 'tools', 'cpuhook.mjs');
const RESULTS_DIR = join(ROOT, 'results');
const NULL_ENTRY = 'null';

function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const ROUNDS = Math.max(1, parseInt(argValue('rounds', '15'), 10) || 15);

// --- expected answers -------------------------------------------------------
const expectedDoc = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'));
const expectedAnswers = Buffer.from(JSON.stringify(expectedDoc.cases.map((c) => c.output)));
const caseCount = expectedDoc.cases.length;
const inputBytes = readFileSync(join(INPUT_DIR, 'cases.json')).length;

// --- machine info -----------------------------------------------------------
function tryCmd(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
function cpuModel() {
  const out = tryCmd('lscpu', []);
  const m = out && out.match(/^Model name:\s*(.+)$/m);
  return (m && m[1].trim()) || (cpus()[0] && cpus()[0].model) || 'unknown';
}
const machine = {
  cpu: cpuModel(),
  cores: tryCmd('nproc', []) || String(cpus().length),
  node: process.version,
  kernel: `${platform()} ${release()} (${arch()})`,
  host: hostname(),
};

// --- running ----------------------------------------------------------------
const entries = readdirSync(ENTRIES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ENTRIES_DIR, d.name, 'main.ts')))
  .map((d) => d.name)
  .sort();
if (!entries.includes(NULL_ENTRY)) {
  console.error(`error: entries/${NULL_ENTRY} is missing — net numbers need the null control`);
  process.exit(2);
}

const times = Object.fromEntries(entries.map((e) => [e, []]));
const failures = [];

function runOnce(entry) {
  const outDir = mkdtempSync(join(tmpdir(), 'speed-bench-'));
  try {
    const res = spawnSync('taskset', ['-c', '0', process.execPath, '--import', HOOK, join(ENTRIES_DIR, entry, 'main.ts')], {
      env: { ...process.env, MAKEFUN_INPUT_DIR: INPUT_DIR, MAKEFUN_OUTPUT_DIR: outDir },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const m = (res.stderr || '').match(/^CPU ([0-9.]+)$/m);
    if (res.status !== 0 || !m) {
      failures.push(`${entry}: run failed (status ${res.status}) ${(res.stderr || '').slice(0, 200)}`);
      return;
    }
    const answersPath = join(outDir, 'answers.json');
    if (!existsSync(answersPath)) {
      failures.push(`${entry}: no answers.json written`);
      return;
    }
    const got = readFileSync(answersPath);
    if (entry === NULL_ENTRY) {
      let arr = null;
      try {
        arr = JSON.parse(got.toString('utf8'));
      } catch {
        /* handled below */
      }
      if (!Array.isArray(arr) || arr.length !== caseCount) {
        failures.push(`${entry}: null output is not an array of ${caseCount} answers`);
        return;
      }
    } else if (!got.equals(expectedAnswers)) {
      failures.push(`${entry}: answers.json (${got.length} bytes) != expected answers (${expectedAnswers.length} bytes)`);
      return;
    }
    times[entry].push(parseFloat(m[1]));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

for (let r = 0; r < ROUNDS; r++) {
  const order = entries.map((_, i) => entries[(i + r) % entries.length]);
  for (const entry of order) runOnce(entry);
  console.error(`round ${r + 1}/${ROUNDS} done`);
}

// --- stats ------------------------------------------------------------------
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function trimmedMean(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length * 0.2);
  const core = s.length - 2 * k >= 1 ? s.slice(k, s.length - k) : s;
  return core.reduce((a, b) => a + b, 0) / core.length;
}
const fmt = (x) => x.toFixed(3);
const stats = Object.fromEntries(
  entries.map((e) => [e, { n: times[e].length, median: median(times[e]), trimmed: trimmedMean(times[e]) }]),
);
const nullStats = stats[NULL_ENTRY];

// --- report -----------------------------------------------------------------
const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19) + 'Z';
const runNo = process.env.GITHUB_RUN_NUMBER;
const label = argValue('label', runNo ? `run-${runNo}-${stamp}` : `bench-${stamp}`);

const lines = [];
lines.push(`# speed-bench results — ${label}`);
lines.push('');
lines.push(`- date (UTC): ${now.toISOString()}`);
lines.push(`- rounds: ${ROUNDS} per entry, interleaved with rotating order, pinned to one CPU (taskset -c 0)`);
lines.push(`- metric: total CPU seconds per run (user + sys, all threads), via tools/cpuhook.mjs`);
lines.push(`- workload: practice/input/cases.json — ${caseCount} cases, ${inputBytes.toLocaleString('en-US')} input bytes; expected answers ${expectedAnswers.length.toLocaleString('en-US')} bytes`);
lines.push('');
lines.push('## Machine');
lines.push('');
lines.push('| | |');
lines.push('|---|---|');
lines.push(`| CPU | ${machine.cpu} |`);
lines.push(`| cores (nproc) | ${machine.cores} |`);
lines.push(`| Node | ${machine.node} |`);
lines.push(`| kernel / OS | ${machine.kernel} |`);
lines.push(`| host | ${machine.host} |`);
lines.push('');
lines.push('## Results (CPU seconds, lower is better)');
lines.push('');
lines.push('| entry | runs | median | trimmed mean (20%) | net median (vs null) | net trimmed (vs null) |');
lines.push('|---|---:|---:|---:|---:|---:|');
for (const e of entries) {
  const s = stats[e];
  lines.push(
    `| ${e} | ${s.n} | ${fmt(s.median)} | ${fmt(s.trimmed)} | ${fmt(s.median - nullStats.median)} | ${fmt(s.trimmed - nullStats.trimmed)} |`,
  );
}
lines.push('');
lines.push('Net = entry minus the null control, the same accounting make.fun\'s heat uses (there the control is pooled over rounds and subtracted unclamped). This runner\'s hook measures total process CPU only, so no post-startup split is reported here; the instrumented stage profile lives in the makefun foundations notes (foundations/speed/v2/README.md).');
lines.push('');
lines.push('## Raw runs (CPU seconds, in run order)');
lines.push('');
for (const e of entries) lines.push(`- ${e}: ${times[e].map(fmt).join(', ')}`);
lines.push('');
if (failures.length) {
  lines.push('## FAILURES');
  lines.push('');
  for (const f of failures) lines.push(`- ${f}`);
  lines.push('');
} else {
  lines.push(`Verification: every non-null run's answers.json byte-equals the expected practice answers; the null control wrote ${caseCount} empty answers per run.`);
  lines.push('');
}

const report = lines.join('\n');
writeFileSync(join(RESULTS_DIR, `${label}.md`), report);
console.log(report);
if (failures.length) {
  console.error(`FAILED: ${failures.length} problem(s) — see the report`);
  process.exit(1);
}
