export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { config } = await import("dotenv");
    const { parseEnv, parseAuthEnv } = await import("@aia/config");
    config({ path: "../../.env", quiet: true });
    parseEnv(process.env);
    parseAuthEnv(process.env);
  }
}
