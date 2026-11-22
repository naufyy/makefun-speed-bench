# makefun-speed-bench

A fast, quiet CPU for measuring make.fun speed-competition entries.

## Why this exists

The development VM is a throttled, contended shared vCPU: process startup alone swings by
~150 ms there, which swamps the millisecond differences that decide speed competitions.
This repo runs the same entries on a GitHub-hosted runner instead — same workload, same
total-CPU accounting (user + sys via `tools/cpuhook.mjs`, the hook the local workbench's
`bench.sh` uses), one pinned CPU, interleaved rounds — and commits the report back here so
runs can be compared over time.

One caution carried over from the foundations measurements: make.fun's own heat reads CPU
in coarse clock ticks (up to 10 ms) and subtracts a pooled do-nothing control, so tiny
server-side differences quantize away. Treat the numbers here as "which pipeline is
genuinely faster, and by roughly how much", not as a prediction of the board.

## Layout

```
bench.mjs                  the runner (dependency-free Node)
tools/cpuhook.mjs          preload that prints the process's total CPU on exit
practice/input/cases.json  the standard workload (csv-reader-speed-01 practice set)
practice/reference/expected.json
                           the oracle's expected outputs (answers are derived from it)
entries/<name>/            one directory per entry under test: main.ts (+ solve.js)
entries/null/              the null control (floor measurement, see below)
results/                   committed Markdown reports, one per run
.github/workflows/bench.yml
```

The workload is the csv-reader-speed-01 practice set: 6 cases, 11,064,623 input bytes,
12,073,155 expected answer bytes (the expected.json file itself is 12,073,593 bytes — it
wraps each case's output with its id and group).

Entries under test today:

- `champion` — the live csv-reader-speed-01 entry (AssemblyScript WASM transducer).
- `v2` — the foundations/speed/v2 scaffold example (single-pass WASM, size-optimised build,
  driver pre-touch).
- `null` — the control, server-style: it does **not** read or parse the input at all; it
  starts up and writes one empty answer per case (the case count, 6, is hardcoded from the
  practice set). This mirrors make.fun's own heat control (`grader/code-heat.ts`), whose
  subtraction floor is just process start plus an output write. Every entry is also reported
  **net of null**, mirroring that subtraction. (An earlier version of this null read and
  JSON.parsed the 11 MB cases file, which made the floor heavier than the real entries —
  they avoid JSON.parse entirely — and pushed the net numbers negative.)

## Running it

- **On GitHub:** push to `main`, or open the Actions tab → *bench* → *Run workflow*.
  The workflow runs `node bench.mjs --rounds 15` on `ubuntu-latest` with Node 22 and
  commits the new report under `results/` with the built-in token (the commit message
  carries the run number and date; `results/**` is path-ignored and the message carries
  `[skip ci]`, so the results commit never retriggers the bench).
- **Locally:** `node bench.mjs --rounds 15` (needs `taskset`, i.e. Linux; `--label <name>`
  overrides the report file name). Expect noisy numbers on a shared VM — that is the
  problem this repo exists to escape.

Each run: rounds rotate the entry order to cancel drift, every run is pinned to CPU 0,
and every non-null entry's `answers.json` must byte-equal the expected practice answers —
a mismatch fails the run (exit non-zero) and is listed in the report.

## Adding an entry

1. Create `entries/<name>/` and drop in the entry's `main.ts` (plus `solve.js` or whatever
   else it needs to run standalone). Entries are discovered automatically; the name
   `null` is reserved for the control.
2. The entry must honor the program/v1 driver contract: read
   `$MAKEFUN_INPUT_DIR/cases.json`, write `$MAKEFUN_OUTPUT_DIR/answers.json`.
3. Push. The next report includes the new entry, verified against the same expected
   answers.

## Reading the results

Each file in `results/` is one run: machine info (CPU model, core count, Node version,
kernel), then per entry the **median** and **trimmed mean** (20% trimmed) of total CPU
seconds over the rounds, plus both figures **net of the null control**. Compare net
medians across reports from the same class of machine; absolute numbers move with the
runner hardware, the ordering and the gaps are the signal. Raw per-round readings are
listed at the bottom of every report.
