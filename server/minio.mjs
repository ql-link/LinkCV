import { Client } from "minio";
import { extname } from "node:path";

const endpointUrl = new URL(process.env.MINIO_ENDPOINT ?? "http://103.205.254.30:39000");

export const minioConfig = {
  endPoint: endpointUrl.hostname,
  port: Number(endpointUrl.port || (endpointUrl.protocol === "https:" ? 443 : 80)),
  useSSL: endpointUrl.protocol === "https:",
  accessKey: process.env.MINIO_ACCESS_KEY ?? "root",
  secretKey: process.env.MINIO_SECRET_KEY ?? "ql354210",
  bucket: process.env.MINIO_BUCKET ?? "linkcv",
};

export const minioClient = new Client({
  endPoint: minioConfig.endPoint,
  port: minioConfig.port,
  useSSL: minioConfig.useSSL,
  accessKey: minioConfig.accessKey,
  secretKey: minioConfig.secretKey,
});

const supportedImageTypes = new Map([
  ["image/apng", ".apng"],
  ["image/avif", ".avif"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/svg+xml", ".svg"],
  ["image/webp", ".webp"],
]);

const imageExtensions = new Map(
  Array.from(supportedImageTypes.entries()).map(([contentType, extension]) => [
    extension,
    contentType,
  ]),
);

let bucketReadyPromise;

export function isSupportedImageType(contentType) {
  return supportedImageTypes.has(contentType);
}

export function inferImageContentType(objectName) {
  return imageExtensions.get(extname(objectName).toLowerCase()) ?? "application/octet-stream";
}

export async function ensureAssetBucket() {
  if (!bucketReadyPromise) {
    bucketReadyPromise = (async () => {
      const exists = await minioClient.bucketExists(minioConfig.bucket);
      if (!exists) {
        await minioClient.makeBucket(minioConfig.bucket);
      }
    })();
  }

  return bucketReadyPromise;
}

export function dataUrlToImage(dataUrl) {
  if (typeof dataUrl !== "string") return null;

  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;

  const contentType = match[1].toLowerCase();
  if (!isSupportedImageType(contentType)) return null;

  return {
    buffer: Buffer.from(match[2], "base64"),
    contentType,
  };
}

export function buildAssetObjectName({ userId, fileName, contentType }) {
  const safeName = String(fileName ?? "image")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const fromName = extname(safeName).toLowerCase();
  const extension = fromName || supportedImageTypes.get(contentType) || ".bin";
  const baseName = safeName && safeName !== extension ? safeName.replace(/\.[^.]*$/, "") : "image";
  const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `users/${userId}/assets/${uniquePart}-${baseName}${extension}`;
}

export async function uploadAssetObject({ objectName, buffer, contentType }) {
  await ensureAssetBucket();
  await minioClient.putObject(minioConfig.bucket, objectName, buffer, buffer.length, {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
}

export async function getAssetObject(objectName) {
  await ensureAssetBucket();
  return minioClient.getObject(minioConfig.bucket, objectName);
}
