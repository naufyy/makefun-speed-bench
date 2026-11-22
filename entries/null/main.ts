// Null control (server-style): the floor under every measurement, mirroring make.fun's own
// heat control (grader/code-heat.ts). It does NOT read or parse the input file at all — it
// starts up and writes /output/answers.json with one empty answer (null) per case, then
// exits. Its CPU is what process start and the interpreter cost on this machine, which is
// exactly the floor the heat subtracts from every entry; bench.mjs reports every entry net
// of it.
//
// The case count (6) is hardcoded from the current practice set
// (practice/reference/expected.json has 6 cases); if the workload changes, update it here.
// An earlier local version read and JSON.parsed the 11 MB cases file, which made the
// "floor" heavier than real entries (they avoid JSON.parse entirely) and pushed net numbers
// negative — that is why this control reads nothing.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const CASE_COUNT = 6; // practice set size — see comment above

writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(Array.from({ length: CASE_COUNT }, () => null)));
