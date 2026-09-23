import { Prisma, type PrismaClient } from "@aia/database";
import { DomainError } from "./errors.ts";
export type Tx = Prisma.TransactionClient;
export async function transaction<T>(db: PrismaClient, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        if (attempt < 2) continue;
        throw new DomainError("STALE_WRITE");
      }
      throw error;
    }
  }
}

