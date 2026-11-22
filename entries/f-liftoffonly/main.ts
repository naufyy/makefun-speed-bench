// The harness driver: `node /bot/main.ts` (Node 22). Reads every case from /input/cases.json (a JSON array of
// {id, input}), answers each one with solve.js, and writes /output/answers.json: the JSON array of the answers, one
// per case and in the cases' order. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input
// and /output.
//
// The file is read straight into the WebAssembly module's memory, and the module writes the answers array as JSON in
// one pass (solve.js's transduce). A file it does not read (not UTF-8, or outside the {id, input: {text, header}}
// shape) is answered the general way: JSON.parse, run() on each case, JSON.stringify.

import { isUtf8 } from 'node:buffer';
import { closeSync, fstatSync, openSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--liftoff-only');

type Solve = {
  run: (input: unknown) => unknown;
  prepare: (length: number) => Uint8Array;
  transduce: () => Uint8Array | null;
};
const solve = (await import(new URL('./solve.js', import.meta.url).href)) as Solve;

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const fd = openSync(join(INPUT_DIR, 'cases.json'), 'r');
const size = fstatSync(fd).size;
const raw = solve.prepare(size);
let got = 0;
while (got < size) {
  const k = readSync(fd, raw, got, size - got, got);
  if (k <= 0) break;
  got += k;
}
closeSync(fd);
if (got !== size) throw new Error('cases.json changed while it was read');

const outPath = join(OUTPUT_DIR, 'answers.json');
const answers = isUtf8(raw) ? solve.transduce() : null;
if (answers !== null) {
  writeFileSync(outPath, answers);
} else {
  const cases = JSON.parse(Buffer.from(raw).toString('utf8')) as { id: string; input: unknown }[];
  const all: unknown[] = [];
  for (const c of cases) all.push(solve.run(c.input));
  writeFileSync(outPath, JSON.stringify(all));
}
