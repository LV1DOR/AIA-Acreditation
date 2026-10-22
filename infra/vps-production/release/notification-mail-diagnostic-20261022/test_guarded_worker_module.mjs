import assert from 'node:assert/strict';
import { deriveRenderOnlyModule, sanitizedError } from './guarded_worker_module.mjs';
const functions = `async function renderBusinessEmail() { return 'synthetic'; }
async function prepareSmtpMessage() { return {}; }
function smtpTransportOptions() { return {}; }
function main() { throw Error('NEVER_START_APPLICATION'); }
`;
const tail = 'main().catch(() => { logger.error("STARTUP_FAILED"); process.exit(1); });';
const output = deriveRenderOnlyModule(functions + tail);
assert.ok(output.startsWith(functions));
assert.ok(!output.includes(tail));
assert.ok(output.includes('export { renderBusinessEmail, prepareSmtpMessage, smtpTransportOptions }'));
for (const source of [functions, functions + 'main();', functions + tail + '\nconsole.log("extra");', functions + 'main();\n' + tail, functions + 'const unsafe = main();\n' + tail, functions + 'export { main };\n' + tail, functions.replace('function smtpTransportOptions()', 'function unrelated()') + tail, functions + 'main().catch(() => { console.log("unreviewed"); });']) {
  assert.throws(() => deriveRenderOnlyModule(source));
}
const unsafe = sanitizedError(Object.assign(new Error('SYNTHETIC_PRIVATE_TOKEN'), { response: 'SYNTHETIC_PRIVATE_TOKEN', stack: 'SYNTHETIC_PRIVATE_TOKEN' }));
assert.equal(JSON.stringify(unsafe).includes('SYNTHETIC_PRIVATE_TOKEN'), false);
assert.deepEqual(sanitizedError(new Error('Dynamic require of "stream" is not supported')), { code: 'BUNDLED_ESM_DYNAMIC_REQUIRE_UNSUPPORTED', builtin: 'stream' });
assert.deepEqual(sanitizedError({ name: 'ZodError', issues: [{ path: ['to'], input: 'SYNTHETIC_PRIVATE_TOKEN' }] }), { code: 'MESSAGE_VALIDATION_FAILED', fields: ['to'] });
console.log('RENDER_ONLY_STARTUP_GUARDS_AND_SANITIZED_ERRORS_PASSED');
