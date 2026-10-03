import { z } from "zod";
const optional = (schema: z.ZodString) => z.preprocess(value => value === "" ? undefined : value, schema.optional());
const origin = z.url().refine(value => {
  const url = new URL(value);
  return url.origin === value && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
});
const additionalOrigins = z.preprocess(value => {
  if (value === undefined || value === "") return [];
  return typeof value === "string" ? value.split(",").map(item => item.trim()).filter(Boolean) : value;
}, z.array(origin).max(5).transform(values => [...new Set(values)]));
const schema = z.object({
  APP_ORIGIN: origin.default("http://127.0.0.1:3100"),
  AUTH_ADDITIONAL_ORIGINS: additionalOrigins.default([]),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: optional(z.string().regex(/^pk_(test|live)_/)),
  CLERK_SECRET_KEY: optional(z.string().regex(/^sk_(test|live)_/)),
  CLERK_WEBHOOK_SIGNING_SECRET: optional(z.string().regex(/^whsec_/)),
  AUTH_EMAIL_ENCRYPTION_KEY: optional(z.string().regex(/^[a-f0-9]{64}$/i)),
}).refine(value => Boolean(value.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) === Boolean(value.CLERK_SECRET_KEY))
  .refine(value => !value.CLERK_SECRET_KEY || Boolean(value.CLERK_WEBHOOK_SIGNING_SECRET && value.AUTH_EMAIL_ENCRYPTION_KEY));
export type AuthEnvironment = z.infer<typeof schema>;
export type AuthEnvironmentState =
  | { status: "MISSING" }
  | { status: "INVALID" }
  | { status: "READY"; environment: AuthEnvironment };

export function parseAuthEnv(input: Record<string, string | undefined>) {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error("INVALID_AUTH_ENVIRONMENT");
  return result.data;
}

export function inspectAuthEnv(input: Record<string, string | undefined>): AuthEnvironmentState {
  const configuredValues = [
    input.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    input.CLERK_SECRET_KEY,
    input.CLERK_WEBHOOK_SIGNING_SECRET,
    input.AUTH_EMAIL_ENCRYPTION_KEY,
  ];
  if (configuredValues.every(value => !value)) return { status: "MISSING" };
  const result = schema.safeParse(input);
  if (!result.success || !result.data.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !result.data.CLERK_SECRET_KEY ||
    !result.data.CLERK_WEBHOOK_SIGNING_SECRET || !result.data.AUTH_EMAIL_ENCRYPTION_KEY) {
    return { status: "INVALID" };
  }
  return { status: "READY", environment: result.data };
}
