import { expect, it } from "vitest";
import sharp from "../../packages/storage/node_modules/sharp/dist/index.mjs";
import { MAX_PARTICIPANT_PHOTO_BYTES, MAX_PROCESSED_PHOTO_BYTES, processParticipantPhoto, processEventBanner, withImageProcessingSlot } from "../../packages/storage/src/index.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

it("F04 accepts actual PNG/JPEG, strips metadata and keeps JPEG output", async () => {
  const jpeg = await sharp(png).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  for (const [bytes, type] of [[png, "image/png"], [jpeg, "image/jpeg"]] as const) {
    const result = await processParticipantPhoto(bytes, type);
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(result.length).toBeLessThanOrEqual(MAX_PROCESSED_PHOTO_BYTES);
  }
  expect((await sharp(await processEventBanner(png, "image/png")).metadata()).format).toBe("jpeg");
});

it.each([
  [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'), "image/jpeg"],
  [png, "image/jpeg"], [Buffer.from([0xff, 0xd8, 0xff, 0]), "image/jpeg"],
  [Buffer.from("GIF89a"), "image/jpeg"], [png, "image/webp"],
  [Buffer.alloc(MAX_PARTICIPANT_PHOTO_BYTES + 1), "image/png"],
] as const)("F04/F05 rejects deceptive, unsupported, malformed and oversized bytes %#", async (bytes, type) => {
  await expect(processParticipantPhoto(bytes, type)).rejects.toThrow("INVALID_PHOTO");
});

it("F04/F05 rejects oversized pixel dimensions from the header before allocating a raster", async () => {
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(10_000, 16); oversized.writeUInt32BE(10_000, 20);
  // Correct IHDR CRC so this exercises the dimension boundary, not just checksum validation.
  let crc = 0xffffffff;
  for (const byte of oversized.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  oversized.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  await expect(processParticipantPhoto(oversized, "image/png")).rejects.toThrow("INVALID_PHOTO");
});

it("F05 bounds concurrent image jobs without accumulating a queue and releases failed slots", async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const first = withImageProcessingSlot(() => held), second = withImageProcessingSlot(() => held);
  await expect(withImageProcessingSlot(async () => "third")).rejects.toThrow("IMAGE_PROCESSING_BUSY");
  await expect(processParticipantPhoto(png, "image/png")).rejects.toThrow("IMAGE_PROCESSING_BUSY");
  release(); await Promise.all([first, second]);
  await expect(withImageProcessingSlot(async () => { throw new Error("synthetic"); })).rejects.toThrow("synthetic");
  expect(await withImageProcessingSlot(async () => "recovered")).toBe("recovered");
});
