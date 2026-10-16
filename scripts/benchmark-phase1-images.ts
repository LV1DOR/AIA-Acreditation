import { performance } from "node:perf_hooks";
import { processParticipantPhoto } from "../packages/storage/src/index.ts";
import sharp from "../packages/storage/node_modules/sharp/dist/index.mjs";

// Bounded synthetic burst, not a stress or operational capacity certification.
const pixels = Buffer.alloc(1200 * 1200 * 3);
for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31 + Math.floor(i / 1200)) % 256;
const jpeg = await sharp(pixels, { raw: { width: 1200, height: 1200, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
const start = performance.now();
const results = await Promise.allSettled(Array.from({ length: 12 }, () => processParticipantPhoto(jpeg, "image/jpeg")));
const accepted = results.filter(result => result.status === "fulfilled").length;
const rejected = results.length - accepted;
const recovered = await processParticipantPhoto(jpeg, "image/jpeg");
console.log(JSON.stringify({ inputBytes: jpeg.length, dimensions: "1200x1200", concurrentRequests: results.length, accepted, rejected, elapsedMs: Math.round(performance.now() - start), recoveredBytes: recovered.length, rssMiB: Math.round(process.memoryUsage().rss / 1048576) }));
if (accepted !== 2 || rejected !== 10 || recovered.length === 0) process.exitCode = 1;
