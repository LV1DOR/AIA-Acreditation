import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { calendarDate, toDate } from "../shared/calendar-date.ts";
import { DomainError } from "../shared/errors.ts";
const input = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
  startDate: calendarDate, endDate: calendarDate,
  onboardingOpensAt: z.iso.datetime({ offset: true }), onboardingClosesAt: z.iso.datetime({ offset: true }),
  timezone: z.string().refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }).default("Europe/Lisbon")
}).strict().refine(v => v.startDate <= v.endDate && new Date(v.onboardingOpensAt) < new Date(v.onboardingClosesAt), "Invalid date range");
export async function createEvent(db: PrismaClient, context: ActorContext, raw: z.input<typeof input>) {
  const data = input.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const event = await tx.event.create({ data: { ...data, startDate: toDate(data.startDate), endDate: toDate(data.endDate), onboardingOpensAt: new Date(data.onboardingOpensAt), onboardingClosesAt: new Date(data.onboardingClosesAt) } });
    await appendAudit(tx, actor, { action: "EVENT_CREATED", entityType: "Event", entityId: event.id, eventId: event.id });
    await enqueueInvalidation(tx, "event:" + event.id + ":1", { entityId: event.id, eventId: event.id, version: 1 });
    return event;
  });
}

const updateInput = input.extend({
  id: z.uuid(), expectedVersion: z.number().int().positive(),
  status: z.enum(["DRAFT", "ONBOARDING_OPEN", "ONBOARDING_CLOSED", "ACTIVE", "COMPLETED", "ARCHIVED"]),
}).strict();
export async function updateEvent(db: PrismaClient, context: ActorContext, raw: z.input<typeof updateInput>) {
  const data = updateInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const { id, expectedVersion, ...values } = data;
    const changed = await tx.event.updateMany({ where: { id, version: expectedVersion }, data: {
      ...values, slug: values.slug ?? null, startDate: toDate(values.startDate), endDate: toDate(values.endDate),
      onboardingOpensAt: new Date(values.onboardingOpensAt), onboardingClosesAt: new Date(values.onboardingClosesAt),
      version: { increment: 1 },
    } });
    if (changed.count !== 1) throw new DomainError("STALE_WRITE");
    const version = expectedVersion + 1;
    await appendAudit(tx, actor, { action: "EVENT_UPDATED", entityType: "Event", entityId: id, eventId: id, metadata: { version } });
    await enqueueInvalidation(tx, `event:${id}:${version}`, { entityId: id, eventId: id, version });
    return { id, version };
  });
}
