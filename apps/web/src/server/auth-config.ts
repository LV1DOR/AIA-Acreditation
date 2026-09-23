import "server-only";
import { inspectAuthEnv } from "@aia/config";
export function authConfiguration() {
  return inspectAuthEnv(process.env);
}
export function authConfigured() {
  return authConfiguration().status === "READY";
}
