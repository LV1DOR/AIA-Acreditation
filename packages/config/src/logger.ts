import pino, { type DestinationStream } from "pino";
import { z } from "zod";
const fields = z.object({
  requestId: z.uuid().optional(), eventId: z.uuid().optional(),
  companyId: z.uuid().optional(), userId: z.uuid().optional(), jobId: z.uuid().optional()
}).strip();
export type LogCode = "WORKER_STARTED" | "WORKER_STOPPED" | "DEPENDENCY_UNAVAILABLE" | "STARTUP_FAILED" | "REQUEST_FAILED";
export function createLogger(destination?: DestinationStream) {
  const logger = destination ? pino({ base: undefined }, destination) : pino({ base: undefined });
  function safe(raw: unknown) { const result = fields.safeParse(raw); return result.success ? result.data : {}; }
  return {
    info(code: LogCode, context: unknown = {}) { logger.info({ code, ...safe(context) }); },
    error(code: LogCode, context: unknown = {}) { logger.error({ code, ...safe(context) }); },
  };
}

