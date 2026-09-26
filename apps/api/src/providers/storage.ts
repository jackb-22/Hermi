import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.ts';

export interface Storage {
  readonly name: string;
  /** Presigned PUT the app uploads to directly (bypassing the API). */
  presignPut(key: string, contentType: string, expiresS?: number): Promise<string>;
  presignGet(key: string, expiresS?: number): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer, contentType: string, opts?: { public?: boolean }): Promise<void>;
  /** CDN URL for public objects (feed renditions under unguessable keys). */
  publicUrl(key: string): string;
}

export const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export class S3Storage implements Storage {
  readonly name = 's3';
  private s3: S3Client;
  private ready?: Promise<void>;
  constructor(private c: Config) {
    this.s3 = new S3Client({
      region: c.S3_REGION,
      endpoint: c.S3_ENDPOINT,
      forcePathStyle: c.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: c.S3_KEY!, secretAccessKey: c.S3_SECRET! },
    });
  }

  /** Dev convenience: create the bucket on first use (Spaces buckets are created in the console). */
  private ensureBucket() {
    this.ready ??= (async () => {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: this.c.S3_BUCKET }));
      } catch {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.c.S3_BUCKET })).catch(() => {});
      }
    })();
    return this.ready;
  }

  async presignPut(key: string, contentType: string, expiresS = 900) {
    await this.ensureBucket();
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.c.S3_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: expiresS },
    );
  }
  async presignGet(key: string, expiresS = 3600) {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.c.S3_BUCKET, Key: key }), {
      expiresIn: expiresS,
    });
  }
  async get(key: string) {
    await this.ensureBucket();
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.c.S3_BUCKET, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }
  async put(key: string, body: Buffer, contentType: string, opts: { public?: boolean } = {}) {
    await this.ensureBucket();
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.c.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: opts.public ? 'public-read' : undefined,
        CacheControl: opts.public ? 'public, max-age=31536000, immutable' : undefined,
      }),
    );
  }
  publicUrl(key: string) {
    const base = this.c.CDN_BASE_URL ?? `${this.c.S3_ENDPOINT}/${this.c.S3_BUCKET}`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }
}

/** In-memory storage for tests and for running without any S3 at all. */
export class MemoryStorage implements Storage {
  readonly name = 'memory';
  objects = new Map<string, { body: Buffer; contentType: string }>();
  constructor(private base: string) {}
  async presignPut(key: string) {
    return `${this.base}/v1/media/upload/${encodeURIComponent(key)}`;
  }
  async presignGet(key: string) {
    return `${this.base}/media/${key}`;
  }
  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  publicUrl(key: string) {
    return `${this.base}/media/${key}`;
  }
}

export function createStorage(c: Config): Storage {
  return c.S3_ENDPOINT && c.S3_KEY && c.S3_SECRET
    ? new S3Storage(c)
    : new MemoryStorage(c.PUBLIC_BASE_URL.replace(/\/$/, ''));
}
