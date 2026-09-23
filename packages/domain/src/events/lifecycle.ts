import type { EventStatus } from "@aia/database";

type ScheduledEvent = {
  endDate: Date;
  onboardingClosesAt: Date;
  onboardingOpensAt: Date;
  startDate: Date;
  timezone: string;
};

function calendarDateAt(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: timezone,
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function publishedEventStatus(event: ScheduledEvent, now = new Date()): EventStatus {
  if (now < event.onboardingOpensAt) return "ONBOARDING_CLOSED";
  if (now < event.onboardingClosesAt) return "ONBOARDING_OPEN";
  const today = calendarDateAt(now, event.timezone);
  const start = event.startDate.toISOString().slice(0, 10);
  const end = event.endDate.toISOString().slice(0, 10);
  if (today < start) return "ONBOARDING_CLOSED";
  if (today <= end) return "ACTIVE";
  return "COMPLETED";
}

export function effectiveEventStatus(event: ScheduledEvent & { status: EventStatus }, now = new Date()): EventStatus {
  if (event.status === "DRAFT" || event.status === "ARCHIVED") return event.status;
  return publishedEventStatus(event, now);
}

export function isPublishedEvent(status: EventStatus) {
  return status !== "DRAFT" && status !== "ARCHIVED";
}
