import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IdAllExportError, type IdAllAttendee } from "../../packages/domain/src/exports/id-all.ts";

const mocked = vi.hoisted(() => ({ session: vi.fn(), attendees: vi.fn(), photo: vi.fn() }));
vi.mock("../../apps/web/src/server/session.ts", () => ({ session: mocked.session }));
vi.mock("../../apps/web/src/server/runtime.ts", () => ({ database: () => ({}) }));
vi.mock("../../apps/web/src/server/storage.ts", () => ({ objectStorage: () => ({ getPhoto: mocked.photo }), storageEnvironment: () => ({ DOCUMENT_ENCRYPTION_KEY: "a".repeat(64) }) }));
vi.mock("../../packages/domain/src/exports/id-all.ts", async importOriginal => ({ ...await importOriginal<typeof import("../../packages/domain/src/exports/id-all.ts")>(), idAllAttendees: mocked.attendees }));
const { GET } = await import("../../apps/web/src/app/api/admin/events/[eventId]/id-all/route.ts");
const require = createRequire(new URL("../../packages/domain/package.json", import.meta.url));
const Zip = require("jszip") as { loadAsync(bytes: ArrayBuffer): Promise<{ files: Record<string, unknown> }> };
const person: IdAllAttendee = { id: randomUUID(), fullName: "Synthetic Attendee", role: "Operations", photoObjectKey: "private/photo", companyName: "Synthetic Company" };
const eventId = randomUUID();
const request = () => new Request(`http://localhost/api/admin/events/${eventId}/id-all`);
const params = () => ({ params: Promise.resolve({ eventId }) });
const tempDirectories = async () => (await readdir(tmpdir())).filter(name => name.startsWith("aia-id-all-")).sort();
let before: string[];

beforeEach(async () => {
  vi.resetAllMocks();
  before = await tempDirectories();
  mocked.session.mockResolvedValue({ status: "GRANTED", role: "ADMIN", context: { clerkUserId: "synthetic", correlationId: randomUUID() } });
  mocked.attendees.mockResolvedValue([person]);
  mocked.photo.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]));
});
afterEach(async () => { await expect.poll(tempDirectories).toEqual(before); });

it.each(["SIGNED_OUT", "COMPANY_LEADER"])("denies the download for %s before reading private data", async status => {
  mocked.session.mockResolvedValue(status === "SIGNED_OUT" ? { status } : { status: "GRANTED", role: status });
  const response = await GET(request(), params());
  expect(response.status).toBe(403);
  expect(mocked.attendees).not.toHaveBeenCalled();
  expect(mocked.photo).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("downloads only Excel and photos, repeats the export and cleans up its temporary archive", async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="ID-ALL.zip"');
    const bytes = await response.arrayBuffer();
    expect(bytes.byteLength).toBe(Number(response.headers.get("content-length")));
    const zip = await Zip.loadAsync(bytes);
    expect(Object.keys(zip.files).sort()).toEqual([`Fotos/${person.id}.jpg`, "ID-ALL.xlsx"].sort());
  }
  expect(mocked.photo).toHaveBeenCalledTimes(2);
});

it("returns a useful missing-photo error without a partial download", async () => {
  mocked.photo.mockRejectedValue(new Error("Private storage detail must not be returned"));
  const response = await GET(request(), params());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "PHOTO_UNAVAILABLE", attendeeName: person.fullName });
  expect(response.headers.has("content-disposition")).toBe(false);
});

it("discards the archive when approvals change during generation", async () => {
  mocked.attendees.mockResolvedValueOnce([person]).mockResolvedValueOnce([{ ...person, photoObjectKey: "private/new-photo" }]);
  const response = await GET(request(), params());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "STALE_WRITE" });
});

it("discards the archive when the approved company name changes during generation", async () => {
  mocked.attendees.mockResolvedValueOnce([person]).mockResolvedValueOnce([{ ...person, companyName: "Updated Approved Company" }]);
  const response = await GET(request(), params());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "STALE_WRITE" });
});

it("reports an empty approved set without creating a download", async () => {
  mocked.attendees.mockRejectedValue(new IdAllExportError("NO_APPROVED_ATTENDEES"));
  const response = await GET(request(), params());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "NO_APPROVED_ATTENDEES" });
  expect(mocked.photo).not.toHaveBeenCalled();
});

it("removes the temporary archive when the response is cancelled", async () => {
  const response = await GET(request(), params());
  expect(response.status).toBe(200);
  await response.body!.cancel();
});


it("completes and cleans a synthetic archive larger than the old 64 MiB production tmpfs", async () => {
  mocked.attendees.mockResolvedValue(Array.from({ length: 66 }, (_, index) => ({ ...person, id: randomUUID(), fullName: `Synthetic ${index}` })));
  const jpeg = Buffer.alloc(1024 * 1024); jpeg.set([0xff, 0xd8, 0xff]);
  mocked.photo.mockResolvedValue(jpeg);
  const response = await GET(request(), params());
  expect(response.status).toBe(200);
  expect(Number(response.headers.get("content-length"))).toBeGreaterThan(64 * 1024 * 1024);
  // Consume without accumulating another complete ZIP in test-process memory.
  let received = 0;
  const reader = response.body!.getReader();
  while (true) { const chunk = await reader.read(); if (chunk.done) break; received += chunk.value.byteLength; }
  expect(received).toBe(Number(response.headers.get("content-length")));
}, 15000);
