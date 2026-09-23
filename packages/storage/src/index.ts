import { createConnection } from "node:net";
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";

export type StorageOptions = {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
};

export function createObjectStorage(options: StorageOptions) {
  const client = new S3Client({
    endpoint: options.endpoint,
    forcePathStyle: true,
    region: options.region,
    credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
  });
  return {
    async ensureBucket() {
      try { await client.send(new HeadBucketCommand({ Bucket: options.bucket })); }
      catch { await client.send(new CreateBucketCommand({ Bucket: options.bucket })); }
    },
    async putPhoto(key: string, body: Uint8Array) {
      await client.send(new PutObjectCommand({ Bucket: options.bucket, Key: key, Body: body, ContentType: "image/jpeg", CacheControl: "private, no-store" }));
    },
    async getPhoto(key: string) {
      const result = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }));
      if (!result.Body) throw new Error("OBJECT_NOT_FOUND");
      return result.Body.transformToByteArray();
    },
    async deletePhoto(key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
    },
  };
}

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
export async function processParticipantPhoto(input: Uint8Array, contentType: string) {
  if (!acceptedTypes.has(contentType) || input.byteLength < 1 || input.byteLength > 8 * 1024 * 1024) throw new Error("INVALID_PHOTO");
  try {
    const image = sharp(input, { failOn: "error", limitInputPixels: 30_000_000 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error("INVALID_PHOTO");
    return await image.rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch {
    throw new Error("INVALID_PHOTO");
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
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < input.byteLength; offset += 64 * 1024) {
        const chunk = input.slice(offset, offset + 64 * 1024);
        const length = Buffer.alloc(4); length.writeUInt32BE(chunk.byteLength);
        socket.write(length); socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("end", () => {
      const result = Buffer.concat(chunks).toString("utf8");
      if (!result.includes("OK")) reject(new Error(result.includes("FOUND") ? "MALWARE_DETECTED" : "MALWARE_SCAN_FAILED"));
      else resolve();
    });
  });
}
