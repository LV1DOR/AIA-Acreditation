// Run with native Node inside the real worker image, with no network or secrets.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const email = await import(pathToFileURL(process.argv[2]).href);
assert.equal(process.env.NODE_ENV, 'production');
let checked = 0, logoCid;
for (const template of email.businessEmailTemplate.options) {
  const rendered = await email.renderBusinessEmail(template, { companyName: 'Synthetic Company', eventName: 'Synthetic Event', appUrl: 'https://example.invalid/portal' });
  const prepared = await email.prepareSmtpMessage({ deliveryId: randomUUID(), to: 'synthetic@example.invalid', ...rendered }, 'sender@example.invalid');
  assert.ok(prepared.text.includes('Synthetic Event') && prepared.html.includes('cid:'));
  assert.equal(prepared.attachments.length, 1);
  assert.equal(prepared.attachments[0].contentType, 'image/png');
  logoCid = prepared.attachments[0].cid;
  checked++;
}
assert.ok(checked > 0 && logoCid);
// Invitation HTML is rendered by the web process before encrypted queuing.
// The worker prepares the already-branded payload, including its inline logo.
for (const locale of ['pt', 'en']) {
  const rendered = { subject: locale === 'pt' ? 'Convite AIA sintético' : 'Synthetic AIA invitation',
    text: 'Synthetic invitation https://example.invalid/invite?token=synthetic',
    html: `<html><body><table data-aia-email="branded-v1"><tr><td><img src="cid:${logoCid}"/><a href="https://example.invalid/invite?token=synthetic">${locale}</a></td></tr></table></body></html>` };
  const prepared = await email.prepareSmtpMessage({ deliveryId: randomUUID(), to: 'synthetic@example.invalid', ...rendered }, 'sender@example.invalid');
  assert.ok(prepared.html.includes('cid:' + prepared.attachments[0].cid) && prepared.text.includes('token=synthetic'));
}
console.log(JSON.stringify({ passed: true, businessTemplates: checked, invitationLocales: 2, emailSent: false, databaseAccessed: false, applicationStarted: false }));
