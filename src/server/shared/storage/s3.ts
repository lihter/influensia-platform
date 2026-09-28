import type { StorageAdapter } from "./types";

/**
 * STUB for Cloudflare R2 / S3. Implement with @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner:
 *   put   -> PutObjectCommand
 *   get   -> GetObjectCommand (Body is a Readable)
 *   copy  -> CopyObjectCommand({ CopySource: `${bucket}/${from}` })
 *   downloadUrl -> getSignedUrl(GetObjectCommand, { expiresIn })
 * R2 endpoint: https://<accountid>.r2.cloudflarestorage.com, region "auto".
 */
export class S3Storage implements StorageAdapter {
  constructor(_opts: { bucket: string; endpoint?: string; region?: string }) { void _opts; }
  put(): Promise<{ bytes: number }> { throw new Error("S3Storage not implemented in spike"); }
  get(): Promise<null> { throw new Error("S3Storage not implemented in spike"); }
  copy(): Promise<void> { throw new Error("S3Storage not implemented in spike"); }
  delete(): Promise<void> { throw new Error("S3Storage not implemented in spike"); }
  exists(): Promise<boolean> { throw new Error("S3Storage not implemented in spike"); }
  downloadUrl(): Promise<string> { throw new Error("S3Storage not implemented in spike"); }
}
