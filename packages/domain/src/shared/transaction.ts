import { Prisma, type PrismaClient } from "@aia/database";
import { DomainError } from "./errors.ts";
export type Tx = Prisma.TransactionClient;
function retryableConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return true;
  // adapter-pg can expose the native error directly when COMMIT fails. Retry
  // only PostgreSQL serialization/deadlock failures, never arbitrary DB errors.
  if (!(error instanceof Error) || error.name !== "DriverAdapterError" || !error.cause || typeof error.cause !== "object") return false;
  const cause = error.cause as { kind?: string; originalCode?: string };
  return cause.kind === "TransactionWriteConflict" && (cause.originalCode === "40001" || cause.originalCode === "40P01");
}
export async function transaction<T>(db: PrismaClient, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 });
    } catch (error) {
      if (retryableConflict(error)) {
        if (attempt < 2) continue;
        throw new DomainError("STALE_WRITE");
      }
      throw error;
    }
  }
}

