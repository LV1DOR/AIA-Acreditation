import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createDatabase } from './packages/database/src/index.ts';
const require = createRequire(new URL('./apps/worker/package.json', import.meta.url));
const { createClerkClient } = require('@clerk/backend');
const { z } = require('zod');
let db: ReturnType<typeof createDatabase> | undefined;
let stage = 'CONFIGURATION';
const report: any = { readOnly: true, emailSent: false, messagesClaimedOrRetried: false };
const code = (v: unknown) => typeof v === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(v) ? v : null;
try {
  const email = z.email().parse((process.env.AIA_DIAG_EMAIL ?? '').trim().toLowerCase());
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (process.env.DEPLOYMENT_ENV !== 'production' || target.hostname !== 'postgres' || target.pathname !== '/aia_accreditation_production' || target.username !== 'aia_backup_reader' || target.searchParams.get('sslmode') !== 'verify-full') throw Error('READ_ONLY_PRODUCTION_TARGET_REQUIRED');
  report.clerkConfigured = Boolean(process.env.CLERK_SECRET_KEY?.startsWith('sk_live_'));
  stage = 'CLERK_READ_ONLY_RECIPIENT_LOOKUP';
  let identity: any;
  try {
    if (!report.clerkConfigured) throw Error('CLERK_NOT_CONFIGURED');
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const result = await clerk.users.getUserList({ emailAddress: [email], limit: 10 });
    const users = result.data.filter((u: any) => u.emailAddresses.some((e: any) => e.emailAddress.trim().toLowerCase() === email));
    report.clerkMatchedUsers = users.length;
    if (users.length === 1) identity = users[0];
    report.clerkLookupPassed = true;
  } catch (error: any) {
    report.clerkLookupPassed = false;
    report.clerkHttpStatus = Number.isInteger(error?.status) ? error.status : null;
    report.clerkErrorCodes = Array.isArray(error?.errors) ? error.errors.map((e: any) => typeof e.code === 'string' && /^[a-z_]{1,80}$/.test(e.code) ? e.code : 'SUPPRESSED') : [];
  }
  const primary = identity?.emailAddresses.find((e: any) => e.id === identity.primaryEmailAddressId && e.verification?.status === 'verified');
  const selected = primary ?? identity?.emailAddresses.find((e: any) => e.verification?.status === 'verified');
  report.recipient = { requestedAddressVerified: identity ? identity.emailAddresses.some((e: any) => e.emailAddress.trim().toLowerCase() === email && e.verification?.status === 'verified') : null,
    hasVerifiedDeliveryAddress: identity ? Boolean(selected) : null, workerWouldSelectRequestedMailbox: identity ? Boolean(selected && selected.emailAddress.trim().toLowerCase() === email) : null };
  stage = 'READ_ONLY_DATABASE_TRANSACTION';
  db = createDatabase(process.env.DATABASE_URL!);
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const accepted = await tx.leaderInvitation.findMany({ where: { emailNormalized: email, usedAt: { not: null }, acceptedByUserId: { not: null } }, select: { acceptedByUserId: true }, take: 100 });
    const acceptedIds = [...new Set(accepted.flatMap(r => r.acceptedByUserId ? [r.acceptedByUserId] : []))];
    report.acceptedInvitationAccountMatches = acceptedIds.length;
    const user = identity || acceptedIds.length === 1 ? await tx.user.findUnique({ where: identity ? { clerkUserId: identity.id } : { id: acceptedIds[0]! }, select: { id: true, role: true, disabledAt: true } }) : null;
    report.applicationUser = { exists: Boolean(user), role: user?.role ?? null, disabled: Boolean(user?.disabledAt) };
    if (!user) return;
    report.activeMemberships = await tx.companyLeaderMembership.count({ where: { userId: user.id, revokedAt: null, company: { deactivatedAt: null } } });
    const since = new Date(Date.now() - 72 * 3600000);
    const notifications = await tx.notification.findMany({ where: { recipientUserId: user.id, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 200,
      select: { type: true, createdAt: true, deduplicationKey: true, registrationId: true, parameters: true } });
    const keys = notifications.map(n => 'notification-email:' + n.deduplicationKey);
    const messages = await tx.outboxMessage.findMany({ where: { type: 'BUSINESS_EMAIL', createdAt: { gte: since }, OR: [
      { deduplicationKey: { in: keys } }, { payload: { path: ['recipientUserId'], equals: user.id } }, { recoveryPayload: { path: ['recipientUserId'], equals: user.id } },
    ] }, orderBy: { createdAt: 'desc' }, take: 300, select: { id: true, deduplicationKey: true, createdAt: true, availableAt: true, processedAt: true, terminalAt: true,
      attempts: true, leaseExpiresAt: true, lastFailureCode: true, payload: true, emailDelivery: { select: { status: true, attempts: true, lastFailureCode: true, sentAt: true, recipientHash: true, providerMessageId: true } } } });
    const start = new Date(process.env.AIA_DIAG_WORKER_STARTED ?? '');
    const validStart = Number.isFinite(start.getTime());
    report.windowHours = 72;
    report.resultsMayBeTruncated = notifications.length === 200 || messages.length === 300;
    report.notifications = notifications.map(n => {
      const m = messages.find(m => m.deduplicationKey === 'notification-email:' + n.deduplicationKey);
      const p = n.parameters && typeof n.parameters === 'object' && !Array.isArray(n.parameters) ? n.parameters as Record<string, unknown> : {};
      return { type: code(n.type), updateKind: code(p.updateKind), createdAt: n.createdAt, afterCurrentWorkerStart: validStart ? n.createdAt >= start : null,
        emailQueued: Boolean(m), emailState: m ? m.processedAt ? 'PROCESSED' : m.terminalAt ? 'TERMINAL' : m.leaseExpiresAt && m.leaseExpiresAt > new Date() ? 'LEASED' : 'PENDING' : null,
        attempts: m?.attempts ?? null, deliveryStatus: code(m?.emailDelivery?.status), lastFailureCode: code(m?.lastFailureCode) };
    });
    report.emailMessages = messages.map(m => {
      const p = m.payload && typeof m.payload === 'object' && !Array.isArray(m.payload) ? m.payload as Record<string, unknown> : {};
      return { createdAt: m.createdAt, template: code(p.template), fromNotification: m.deduplicationKey.startsWith('notification-email:'),
        processed: Boolean(m.processedAt), terminal: Boolean(m.terminalAt), attempts: m.attempts, availableAt: m.availableAt,
        activeLease: Boolean(m.leaseExpiresAt && m.leaseExpiresAt > new Date()), failureCode: code(m.lastFailureCode), deliveryStatus: code(m.emailDelivery?.status),
        providerAcceptanceRecorded: Boolean(m.emailDelivery?.providerMessageId), sentAt: m.emailDelivery?.sentAt ?? null,
        recordedRecipientMatchesRequestedMailbox: m.emailDelivery?.recipientHash ? m.emailDelivery.recipientHash === createHash('sha256').update(email).digest('hex') : null };
    });
    report.businessQueue = { pending: await tx.outboxMessage.count({ where: { type: 'BUSINESS_EMAIL', processedAt: null, terminalAt: null } }),
      terminal: await tx.outboxMessage.count({ where: { type: 'BUSINESS_EMAIL', processedAt: null, terminalAt: { not: null } } }) };
    const heartbeat = await tx.operationalHeartbeat.findUnique({ where: { id: 'worker' }, select: { lastSeenAt: true, errorCount: true, lastErrorCode: true } });
    report.workerHeartbeat = heartbeat ? { ...heartbeat, lastErrorCode: code(heartbeat.lastErrorCode) } : null;
  }, { timeout: 20000 });
  report.passed = true;
} catch (error: any) {
  report.passed = false; report.stage = stage;
  report.code = ['READ_ONLY_PRODUCTION_TARGET_REQUIRED', 'CLERK_NOT_CONFIGURED', 'EXACTLY_ONE_CLERK_TEST_USER_REQUIRED'].includes(error?.message) ? error.message
    : /^P\d{4}$/.test(error?.code ?? '') ? error.code : 'DIAGNOSTIC_FAILED_DETAILS_SUPPRESSED';
  if (stage === 'CLERK_READ_ONLY_RECIPIENT_LOOKUP') {
    report.clerkHttpStatus = Number.isInteger(error?.status) ? error.status : null;
    report.clerkErrorCodes = Array.isArray(error?.errors) ? error.errors.map((e: any) => typeof e.code === 'string' && /^[a-z_]{1,80}$/.test(e.code) ? e.code : 'SUPPRESSED') : [];
  }
  process.exitCode = 1;
} finally { await db?.$disconnect(); }
console.log(JSON.stringify(report));
