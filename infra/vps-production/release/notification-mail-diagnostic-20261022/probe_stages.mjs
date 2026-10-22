import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { deriveRenderOnlyModule, sanitizedError } from './guarded_worker_module.mjs';
const require = createRequire(new URL('file:///app/apps/worker/package.json'));
const { parse } = require('dotenv');
const worker = parse(readFileSync('/run/secrets/mail_diagnostic_worker_env'));
const report = { emailSent: false, databaseAccessed: false, servicesRestarted: false, failedMessagesRetried: false, stages: [] };
let functions;
try {
  const original = readFileSync('/app/worker-artifact.mjs', 'utf8');
  const derived = deriveRenderOnlyModule(original);
  report.publicWorkerBundleSha256 = createHash('sha256').update(original).digest('hex');
  report.startupCallRemoved = true;
  const file = '/app/apps/worker/.mail-render-diagnostic-' + randomUUID() + '.mjs';
  writeFileSync(file, derived, { flag: 'wx', mode: 0o600 });
  try { functions = await import(pathToFileURL(file).href); report.stages.push({ stage: 'EXACT_WORKER_BUNDLE_MODULE_LOAD', passed: true }); }
  catch (e) { report.stages.push({ stage: 'EXACT_WORKER_BUNDLE_MODULE_LOAD', passed: false, ...sanitizedError(e) }); }
} catch (e) { report.stages.push({ stage: 'GUARDED_WORKER_ARTIFACT_EXTRACTION', passed: false, ...sanitizedError(e) }); }
if (functions) for (const template of ['STATUS_UPDATE', 'SUBMISSION_APPROVED', 'VEHICLE_PASS_REJECTED']) {
  let stage = 'EXACT_WORKER_EMAIL_RENDER';
  try {
    const rendered = await functions.renderBusinessEmail(template, { companyName: 'Synthetic mail diagnostic', eventName: 'Synthetic mail diagnostic', appUrl: 'https://app.joinaia.pt/portal' });
    stage = 'EXACT_WORKER_MESSAGE_VALIDATION';
    const prepared = await functions.prepareSmtpMessage({ deliveryId: randomUUID(), to: 'diagnostic@example.invalid', ...rendered }, worker.SMTP_FROM);
    if (!prepared.html || !prepared.text || prepared.attachments?.length !== 1) throw Error('BRANDED_MESSAGE_PREPARATION_FAILED');
    report.stages.push({ stage: 'EXACT_WORKER_RENDER_AND_MESSAGE_VALIDATION', template, passed: true });
  } catch (e) { report.stages.push({ stage, template, passed: false, ...sanitizedError(e) }); }
}
// Independent connection verification; never construct or call sendMail.
let smtp;
try {
  const nodemailer = require('nodemailer');
  if (worker.SMTP_HOST !== 'smtp.resend.com' || !['465', '2465'].includes(worker.SMTP_PORT) || worker.SMTP_SECURE !== 'true' || !worker.SMTP_USER || !worker.SMTP_PASSWORD) throw Error('REVIEWED_WORKER_SMTP_CONFIGURATION_REQUIRED');
  smtp = nodemailer.createTransport({ host: worker.SMTP_HOST, port: Number(worker.SMTP_PORT), secure: true,
    auth: { user: worker.SMTP_USER, pass: worker.SMTP_PASSWORD }, logger: false, debug: false,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000, disableFileAccess: true, disableUrlAccess: true });
  await smtp.verify();
  report.stages.push({ stage: 'WORKER_SMTP_CONNECTION_TLS_AUTH_NO_SEND', passed: true, port: Number(worker.SMTP_PORT) });
} catch (e) { report.stages.push({ stage: 'WORKER_SMTP_CONNECTION_TLS_AUTH_NO_SEND', passed: false, port: Number(worker.SMTP_PORT), ...sanitizedError(e) }); }
finally { smtp?.close(); }
try {
  const email = (process.env.AIA_DIAG_EMAIL ?? '').trim().toLowerCase();
  if (!email || !worker.CLERK_SECRET_KEY?.startsWith('sk_live_')) throw Error('CLERK_PRODUCTION_RECIPIENT_LOOKUP_REQUIRED');
  const { createClerkClient } = require('@clerk/backend');
  const clerk = createClerkClient({ secretKey: worker.CLERK_SECRET_KEY });
  const result = await clerk.users.getUserList({ emailAddress: [email], limit: 10 });
  const users = result.data.filter(u => u.emailAddresses.some(e => e.emailAddress.trim().toLowerCase() === email));
  const user = users.length === 1 ? await clerk.users.getUser(users[0].id) : null;
  const selected = user?.emailAddresses.find(e => e.id === user.primaryEmailAddressId && e.verification?.status === 'verified') ?? user?.emailAddresses.find(e => e.verification?.status === 'verified');
  report.stages.push({ stage: 'WORKER_CLERK_GET_USER_VERIFIED_RECIPIENT', passed: Boolean(selected), exactlyOneUser: users.length === 1,
    verifiedAddressMatchesRequestedMailbox: Boolean(selected && selected.emailAddress.trim().toLowerCase() === email) });
} catch (e) { report.stages.push({ stage: 'WORKER_CLERK_GET_USER_VERIFIED_RECIPIENT', passed: false, ...sanitizedError(e) }); }
console.log(JSON.stringify(report));
