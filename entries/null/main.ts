// Null control: the floor under every measurement. Reads /input/cases.json the same way a real
// program/v1 entry does and writes /output/answers.json with one empty answer (null) per case,
// doing no per-case work at all. Its CPU is what process start, the interpreter and the file
// handling cost on this machine; bench.mjs reports every entry net of it.
//
// Note: make.fun's own heat control writes empty outputs without reading the input, so this
// local null (which reads and parses the cases file) is a slightly heavier floor — net numbers
// reported here are conservative.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as unknown[];
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(cases.map(() => null)));
