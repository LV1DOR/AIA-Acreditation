import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deriveRenderOnlyModule, sanitizedError } from './worker-mail-render-guard.mjs';
const [bundle, expectedSha, output, mode = 'fixed'] = process.argv.slice(2);
assert.ok(bundle && /^[a-f0-9]{64}$/.test(expectedSha) && output && ['fixed', 'baseline'].includes(mode));
const source = readFileSync(bundle, 'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'), expectedSha);
writeFileSync(output, deriveRenderOnlyModule(source), { flag: 'wx', mode: 0o600 });
process.env.NODE_ENV = 'production';
if (mode === 'baseline') {
  const renderer = await import(pathToFileURL(output).href);
  for (const template of ['STATUS_UPDATE', 'SUBMISSION_APPROVED', 'VEHICLE_PASS_REJECTED']) {
    let failure;
    try { await renderer.renderBusinessEmail(template, { companyName: 'Synthetic Company', eventName: 'Synthetic Event', appUrl: 'https://example.invalid/portal' }); }
    catch (error) { failure = sanitizedError(error); }
    assert.deepEqual(failure, { code: 'BUNDLED_ESM_DYNAMIC_REQUIRE_UNSUPPORTED', builtin: 'util' });
  }
  console.log('DEPLOYED_WORKER_UTIL_RENDER_FAILURE_REPRODUCED_OFFLINE');
} else {
  const result = spawnSync(process.execPath, [new URL('./worker-mail-native-check.mjs', import.meta.url).pathname, output], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' }, timeout: 90000 });
  assert.equal(result.error, undefined, 'NATIVE_WORKER_TEST_PROCESS_REQUIRED');
  assert.equal(result.status, 0, 'COMPILED_WORKER_EMAIL_RENDER_CHECK_FAILED');
  console.log('COMPILED_WORKER_ALL_EMAILS_AND_INVITATIONS_PASSED_NO_SEND');
}
