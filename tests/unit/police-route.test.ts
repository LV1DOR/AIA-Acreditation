import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ session: vi.fn(), rows: vi.fn() }));
vi.mock("../../apps/web/src/server/session.ts", () => ({ session: mocked.session }));
vi.mock("../../apps/web/src/server/runtime.ts", () => ({ database: () => ({}) }));
vi.mock("../../apps/web/src/server/storage.ts", () => ({ storageEnvironment: () => ({ DOCUMENT_ENCRYPTION_KEY: "a".repeat(64) }) }));
vi.mock("../../packages/domain/src/exports/police.ts", async original => ({ ...await original<typeof import("../../packages/domain/src/exports/police.ts")>(), policeExportData: mocked.rows }));
const { GET } = await import("../../apps/web/src/app/api/admin/events/[eventId]/police/route.ts");
const eventId = randomUUID(), request = () => new Request(`http://localhost/api/admin/events/${eventId}/police`), params = () => ({ params: Promise.resolve({ eventId }) });
beforeEach(() => { vi.resetAllMocks();mocked.session.mockResolvedValue({ status: "GRANTED", role: "ADMIN", context: { clerkUserId: "synthetic", correlationId: randomUUID() } });mocked.rows.mockResolvedValue({ workers: [], responsible: [] }); });
it.each(["SIGNED_OUT", "COMPANY_LEADER"])("denies %s before accessing contact data", async status => {
  mocked.session.mockResolvedValue(status === "SIGNED_OUT" ? { status } : { status: "GRANTED", role: status });
  const response = await GET(request(), params());expect(response.status).toBe(403);expect(mocked.rows).not.toHaveBeenCalled();expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("downloads a private Excel file without photos or storage credentials", async () => {
  const response = await GET(request(), params());expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="Policia.xlsx"');
  expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(response.headers.get("cache-control")).toBe("private, no-store");expect((await response.arrayBuffer()).byteLength).toBe(Number(response.headers.get("content-length")));
});
it("discards stale exports if contacts or statuses change while generating", async () => {
  mocked.rows.mockResolvedValueOnce({ workers: [{ values: ["changed"] }], responsible: [] });
  const response = await GET(request(), params());expect(response.status).toBe(409);expect(await response.json()).toEqual({ code: "STALE_WRITE" });expect(response.headers.has("content-disposition")).toBe(false);
});
it("does not disclose internal errors or contact data on failure", async () => {
  mocked.rows.mockRejectedValue(new Error("private contact details"));const response = await GET(request(), params());expect(response.status).toBe(500);expect(await response.json()).toEqual({ code: "EXPORT_FAILED" });
});
