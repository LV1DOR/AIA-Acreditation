import { config } from "dotenv";
import { validateLocalDevelopment } from "./lib/local-dev.ts";

config({ quiet: true });
validateLocalDevelopment(process.env);
console.log("PASS: local dev targets, synthetic mode, Clerk development keys and Mailpit; no changes");
