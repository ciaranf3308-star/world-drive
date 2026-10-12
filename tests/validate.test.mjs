// Integration test: the network validator must pass on the built data.
// Runs tools/validate.mjs as a child process. Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('validate.mjs passes on clane-network.json', async () => {
  const { stdout } = await execFileAsync('node', ['tools/validate.mjs'], { cwd: new URL('..', import.meta.url).pathname });
  assert.match(stdout, /8\/8 checks passed/);
  assert.doesNotMatch(stdout, /^FAIL/m);
});
