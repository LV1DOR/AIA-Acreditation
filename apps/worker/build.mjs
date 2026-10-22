import process from "node:process";
import {build} from "esbuild";
import {workerRuntimeBanner} from "./runtime-banner.mjs";
const outdir=process.env.WORKER_DIST_DIR??"dist";
if(!/^(dist|\.candidate-[a-z0-9-]+)$/.test(outdir))throw new Error("INVALID_WORKER_BUILD_DIRECTORY");
await build({entryPoints:["src/main.ts"],bundle:true,platform:"node",format:"esm",banner:{js:workerRuntimeBanner},outdir,external:["@prisma/*","pg","pino","zod","dotenv","nodemailer","ioredis","@clerk/backend","sharp","@aws-sdk/*"],logLevel:"info"});
