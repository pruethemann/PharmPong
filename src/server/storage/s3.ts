import type { S3Client } from "@aws-sdk/client-s3";
import type { ObjectStorage } from "./types";

export type S3Config = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

function isNotFound(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const o = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return o.name === "NoSuchKey" || o.name === "NotFound" || o.$metadata?.httpStatusCode === 404;
}

/** S3-compatible storage (Railway buckets, MinIO, AWS). Objects stay private; we proxy reads. */
export function createS3Storage(config: S3Config): ObjectStorage {
  let clientPromise: Promise<{ client: S3Client; sdk: typeof import("@aws-sdk/client-s3") }> | undefined;
  const load = () => {
    clientPromise ??= import("@aws-sdk/client-s3").then((sdk) => ({
      sdk,
      client: new sdk.S3Client({
        endpoint: config.endpoint || undefined,
        region: config.region || "auto",
        forcePathStyle: config.forcePathStyle,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      }),
    }));
    return clientPromise;
  };

  return {
    async put(key, bytes, contentType) {
      const { client, sdk } = await load();
      await client.send(
        new sdk.PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },
    async get(key) {
      const { client, sdk } = await load();
      try {
        const res = await client.send(new sdk.GetObjectCommand({ Bucket: config.bucket, Key: key }));
        if (!res.Body) return null;
        const bytes = await res.Body.transformToByteArray();
        return { bytes, contentType: res.ContentType ?? "application/octet-stream" };
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async delete(key) {
      const { client, sdk } = await load();
      try {
        await client.send(new sdk.DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },
  };
}
