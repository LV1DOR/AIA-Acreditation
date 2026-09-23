import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { createClerkClient } from "@clerk/backend";
import { parseAuthEnv, parseEnv } from "../packages/config/src/index.ts";
import { createDatabase } from "../packages/database/src/index.ts";

loadEnv({ path: ".env", quiet: true });

const clerkAdminUserId = process.env.CLERK_ADMIN_USER_ID;
if (!clerkAdminUserId || !/^user_[A-Za-z0-9]+$/.test(clerkAdminUserId) ||
  process.env.ADMIN_BOOTSTRAP_CONFIRM !== "CREATE_VERIFIED_ADMIN") {
  throw new Error("INVALID_ADMIN_BOOTSTRAP_INPUT");
}
const environment = parseEnv(process.env);
const authentication = parseAuthEnv(process.env);
if (!authentication.CLERK_SECRET_KEY) throw new Error("AUTHENTICATION_NOT_CONFIGURED");

const clerk = createClerkClient({ secretKey: authentication.CLERK_SECRET_KEY });
const identity = await clerk.users.getUser(clerkAdminUserId);
const hasVerifiedEmail = identity.emailAddresses.some(address => address.verification?.status === "verified");
if (!hasVerifiedEmail) throw new Error("CLERK_ADMIN_REQUIRES_VERIFIED_EMAIL");

const db = createDatabase(environment.DATABASE_URL);
try {
  const result = await db.$transaction(async tx => {
    const existing = await tx.user.findUnique({ where: { clerkUserId: identity.id } });
    if (existing) {
      if (existing.role !== "ADMIN" || existing.disabledAt) throw new Error("CLERK_IDENTITY_ALREADY_ASSIGNED");
      return "ALREADY_CONFIGURED" as const;
    }
    const user = await tx.user.create({ data: { clerkUserId: identity.id, role: "ADMIN" } });
    await tx.auditEvent.create({ data: {
      actorType: "SYSTEM",
      action: "ADMIN_BOOTSTRAPPED",
      entityType: "User",
      entityId: user.id,
      correlationId: randomUUID(),
      metadata: {},
    } });
    return "CREATED" as const;
  }, { isolationLevel: "Serializable" });
  process.stdout.write(result + "\n");
} finally {
  await db.$disconnect();
}
