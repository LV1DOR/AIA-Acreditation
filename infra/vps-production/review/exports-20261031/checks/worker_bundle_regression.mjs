import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const env = { ...process.env, NODE_ENV: 'production' };
function run(args, options = {}) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', timeout: 180000, env, ...options });
  assert.equal(result.error, undefined, 'OFFLINE_TEST_PROCESS_REQUIRED');
  assert.equal(result.status, 0, 'COMPILED_WORKER_REGRESSION_FAILED');
}
const baseline = '/app/apps/worker/dist/main.js';
run(['/app/scripts/worker-mail-artifact-check.mjs', baseline,
  '9741a61dae342778a44700d57e88d6cca42772a09a830301a84ba4b1189c7001',
  '/app/apps/worker/.baseline-mail-render.mjs', 'fixed']);
console.log('BUILDING_CANDIDATE_WORKER_BUNDLE_ONLY_OFFLINE_NO_APPLICATION_STARTUP');
run(['build.mjs'], { cwd: '/app/apps/worker', env: { ...env, WORKER_DIST_DIR: '.candidate-mail-esm' } });
const candidate = '/app/apps/worker/.candidate-mail-esm/main.js';
const sha = createHash('sha256').update(readFileSync(candidate)).digest('hex');
run(['/app/scripts/worker-mail-artifact-check.mjs', candidate, sha, '/app/apps/worker/.fixed-mail-render.mjs']);
console.log('RETAINED_FIXED_AND_NEW_WORKER_BUNDLE_REGRESSION_PASSED_NO_NETWORK_NO_DATABASE_NO_SEND');
