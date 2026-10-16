import { z } from "zod";
import { assertProductionConfiguration } from "./deployment-env.ts";
const schema = z.object({
  DATABASE_URL: z.url().refine(v => ["postgres:", "postgresql:"].includes(new URL(v).protocol)),
  REDIS_URL: z.url().refine(v => ["redis:", "rediss:"].includes(new URL(v).protocol)).default("redis://127.0.0.1:16379"),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(3102),
  WORKER_HEALTH_HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  EMAIL_PROVIDER: z.literal("smtp").default("smtp"),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().max(65535),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  SMTP_REQUIRE_TLS: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  SMTP_FROM: z.email(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
}).refine(v => Boolean(v.SMTP_USER) === Boolean(v.SMTP_PASSWORD));
export function parseEnv(input: Record<string, string | undefined>) {
  assertProductionConfiguration(input);
  const parsed = schema.safeParse(input);
  // Zod diagnostics and original input are deliberately not included.
  if (!parsed.success) throw new Error("INVALID_ENVIRONMENT");
  return parsed.data;
}
export type Environment = ReturnType<typeof parseEnv>;

