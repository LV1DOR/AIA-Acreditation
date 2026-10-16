import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { calendarDate, toDate } from "../shared/calendar-date.ts";
import { DomainError } from "../shared/errors.ts";
import { publishedEventStatus } from "./lifecycle.ts";
import { invalidateEffectiveApproval } from "../submissions/integrity.ts";
const input = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
  startDate: calendarDate, endDate: calendarDate,
  onboardingOpensAt: z.iso.datetime({ offset: true }), onboardingClosesAt: z.iso.datetime({ offset: true }),
  timezone: z.string().refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }).default("Europe/Lisbon"),
  publicationState: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
}).strict().refine(v => v.startDate <= v.endDate && new Date(v.onboardingOpensAt) < new Date(v.onboardingClosesAt), "Invalid date range");
export async function createEvent(db: PrismaClient, context: ActorContext, raw: z.input<typeof input>) {
  const data = input.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const { publicationState, ...values } = data;
    const schedule = { ...values, startDate: toDate(values.startDate), endDate: toDate(values.endDate), onboardingOpensAt: new Date(values.onboardingOpensAt), onboardingClosesAt: new Date(values.onboardingClosesAt) };
    const status = publicationState === "PUBLISHED" ? publishedEventStatus(schedule) : "DRAFT";
    const event = await tx.event.create({ data: { ...schedule, status } });
    await appendAudit(tx, actor, { action: "EVENT_CREATED", entityType: "Event", entityId: event.id, eventId: event.id });
    await enqueueInvalidation(tx, "event:" + event.id + ":1", { entityId: event.id, eventId: event.id, version: 1 });
    return event;
  });
}

const updateInput = input.extend({
  id: z.uuid(), expectedVersion: z.number().int().positive(),
}).strict();
export async function updateEvent(db: PrismaClient, context: ActorContext, raw: z.input<typeof updateInput>) {
  const data = updateInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const { id, expectedVersion, publicationState, ...values } = data;
    const previous = await tx.event.findUniqueOrThrow({ where: { id } });
    const schedule = { ...values, startDate: toDate(values.startDate), endDate: toDate(values.endDate), onboardingOpensAt: new Date(values.onboardingOpensAt), onboardingClosesAt: new Date(values.onboardingClosesAt) };
    const status = publicationState === "PUBLISHED" ? publishedEventStatus(schedule) : "DRAFT";
    const changed = await tx.event.updateMany({ where: { id, version: expectedVersion }, data: {
      ...schedule, status, slug: values.slug ?? null,
      version: { increment: 1 },
    } });
    if (changed.count !== 1) throw new DomainError("STALE_WRITE");
    const eligibilityChanged = previous.name !== values.name || previous.timezone !== values.timezone || previous.startDate.getTime() !== schedule.startDate.getTime() || previous.endDate.getTime() !== schedule.endDate.getTime() || previous.onboardingOpensAt.getTime() !== schedule.onboardingOpensAt.getTime() || previous.onboardingClosesAt.getTime() !== schedule.onboardingClosesAt.getTime() || (previous.status === "DRAFT") !== (status === "DRAFT");
    if (eligibilityChanged) {
      const registrations = await tx.companyEventRegistration.findMany({ where: { eventId: id }, select: { id: true } });
      for (const registration of registrations) await invalidateEffectiveApproval(tx, actor, registration.id);
      await tx.eventParticipant.updateMany({ where: { eventId: id, status: "LEADER_APPROVED" }, data: { status: "AWAITING_LEADER_REVIEW", version: { increment: 1 } } });
    }
    const version = expectedVersion + 1;
    await appendAudit(tx, actor, { action: "EVENT_UPDATED", entityType: "Event", entityId: id, eventId: id, metadata: { version } });
    await enqueueInvalidation(tx, `event:${id}:${version}`, { entityId: id, eventId: id, version });
    return { id, version };
  });
}

const bannerInput = z.object({ id: z.uuid(), expectedVersion: z.number().int().positive(), objectKey: z.string().min(1).max(1000).nullable() }).strict();
export async function updateEventBanner(db: PrismaClient, context: ActorContext, raw: z.input<typeof bannerInput>) {
  const data = bannerInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const changed = await tx.event.updateMany({ where: { id: data.id, version: data.expectedVersion }, data: { bannerObjectKey: data.objectKey, version: { increment: 1 } } });
    if (changed.count !== 1) throw new DomainError("STALE_WRITE");
    const version = data.expectedVersion + 1;
    await appendAudit(tx, actor, { action: "EVENT_UPDATED", entityType: "Event", entityId: data.id, eventId: data.id, metadata: { version } });
    await enqueueInvalidation(tx, `event:${data.id}:${version}`, { entityId: data.id, eventId: data.id, version });
    return { id: data.id, version };
  });
}

export async function adminEventBannerAccess(db: PrismaClient, context: ActorContext, eventId: string) {
  requireAdmin(await resolveActor(db, context));
  const event = await db.event.findUnique({ where: { id: z.uuid().parse(eventId) }, select: { bannerObjectKey: true } });
  if (!event?.bannerObjectKey) throw new DomainError("NOT_FOUND");
  return event.bannerObjectKey;
}
