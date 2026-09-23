import { z } from "zod";
export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
export function toDate(value: string): Date { return new Date(calendarDate.parse(value) + "T00:00:00.000Z"); }
export function fromDate(value: Date): string { return value.toISOString().slice(0, 10); }
export function documentValidThroughEvent(expiry: string, eventEnd: string): boolean {
  return calendarDate.parse(expiry) >= calendarDate.parse(eventEnd);
}

