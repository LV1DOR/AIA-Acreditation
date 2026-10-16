import { createConnection } from "node:net";
import { once } from "node:events";
import sharp from "sharp";

export { createObjectStorage, type StorageOptions } from "./object-storage.ts";

// Reject unsupported magic before any native parser; also block SVG in libvips.
sharp.block({ operation: ["VipsForeignLoadSvg"] });
sharp.cache({ memory: 32, files: 0, items: 20 });
sharp.concurrency(1);
export const MAX_PARTICIPANT_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_EVENT_BANNER_BYTES = MAX_PARTICIPANT_PHOTO_BYTES;
export const MAX_PROCESSED_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;
let activeImageJobs = 0;
export async function withImageProcessingSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeImageJobs >= 2) throw new Error("IMAGE_PROCESSING_BUSY");
  activeImageJobs += 1;
  try { return await work(); } finally { activeImageJobs -= 1; }
}

function inputFormat(input: Uint8Array, contentType: string) {
  if (input.byteLength < 3 || input.byteLength > MAX_PARTICIPANT_PHOTO_BYTES) throw new Error("INVALID_IMAGE");
  const format = input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff ? "jpeg"
    : input.length >= 8 && Buffer.from(input.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png" : null;
  if (!format || contentType !== (format === "jpeg" ? "image/jpeg" : "image/png")) throw new Error("INVALID_IMAGE");
  return format;
}

async function raster(input: Uint8Array, contentType: string, banner: boolean) {
  const format = inputFormat(input, contentType);
  const image = sharp(input, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true });
  const metadata = await image.metadata();
  if (metadata.format !== format || !metadata.width || !metadata.height || metadata.width > 10_000 || metadata.height > 10_000 || metadata.width * metadata.height > MAX_IMAGE_PIXELS || (metadata.pages ?? 1) !== 1) throw new Error("INVALID_IMAGE");
  const output = await image.rotate().resize(banner ? { width: 2400, height: 600, fit: "cover", position: "centre", withoutEnlargement: true } : { width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  if (output.byteLength > MAX_PROCESSED_PHOTO_BYTES) throw new Error("INVALID_IMAGE");
  return output;
}
export async function processParticipantPhoto(input: Uint8Array, contentType: string) {
  try {
    return await withImageProcessingSlot(() => raster(input, contentType, false));
  } catch (error) {
    if (error instanceof Error && error.message === "IMAGE_PROCESSING_BUSY") throw error;
    throw new Error("INVALID_PHOTO", { cause: error });
  }
}

export async function processEventBanner(input: Uint8Array, contentType: string) {
  try {
    return await withImageProcessingSlot(() => raster(input, contentType, true));
  } catch (error) {
    if (error instanceof Error && error.message === "IMAGE_PROCESSING_BUSY") throw error;
    throw new Error("INVALID_BANNER", { cause: error });
  }
}

export async function scanWithClamAv(input: Uint8Array, host?: string, port = 3310) {
  if (!host) return;
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    const chunks: Buffer[] = [];
    const fail = () => reject(new Error("MALWARE_SCAN_FAILED"));
    socket.setTimeout(15_000, () => { socket.destroy(); fail(); });
    socket.on("error", fail);
    socket.on("data", chunk => chunks.push(Buffer.from(chunk)));
    socket.on("connect", () => {
      void (async () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < input.byteLength; offset += 64 * 1024) {
          const chunk = input.subarray(offset, offset + 64 * 1024);
          const length = Buffer.alloc(4); length.writeUInt32BE(chunk.byteLength);
          socket.write(length);
          if (!socket.write(chunk)) await once(socket, "drain");
        }
        socket.write(Buffer.alloc(4));
      })().catch(error => { socket.destroy(); reject(error); });
    });
    socket.on("end", () => {
      const result = Buffer.concat(chunks).toString("utf8");
      if (!result.includes("OK")) reject(new Error(result.includes("FOUND") ? "MALWARE_DETECTED" : "MALWARE_SCAN_FAILED"));
      else resolve();
    });
  });
}
