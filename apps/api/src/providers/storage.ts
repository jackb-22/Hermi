import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.ts';

/** One stored object, or the requested byte range of it. */
export interface StoredObject {
  body: Readable | Buffer;
  contentType: string;
  /** Bytes in `body`. */
  length: number;
  /** Size of the whole object. */
  total: number;
  /** Set when a range was served: inclusive first and last byte. */
  range?: { start: number; end: number };
}

export interface Storage {
  readonly name: string;
  /** cdn: public URLs are the CDN and private ones S3 presigned GETs. api: both are /media/<key> on the API. */
  readonly delivery: 'cdn' | 'api';
  /** Presigned PUT the app uploads to directly (bypassing the API). */
  presignPut(key: string, contentType: string, expiresS?: number): Promise<string>;
  presignGet(key: string, expiresS?: number): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  /** The object (or bytes start..end inclusive) for serving; null when there is no such object. */
  stream(key: string, range?: { start: number; end?: number }): Promise<StoredObject | null>;
  put(key: string, body: Buffer, contentType: string, opts?: { public?: boolean }): Promise<void>;
  /** URL for public objects (feed renditions under unguessable keys). */
  publicUrl(key: string): string;
}

export const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Keys under these prefixes are public (random, never reused); anything else needs a signed URL. */
export const PUBLIC_MEDIA_PREFIXES = ['r/', 'p/', 'c2pa/'];

const mediaSig = (secret: string, key: string, exp: number) =>
  createHmac('sha256', secret).update(`${key}:${exp}`).digest('base64url');

/** A private object's URL on the API's /media route, valid until `expiresS` from now. */
export function signMediaUrl(base: string, secret: string, key: string, expiresS: number): string {
  const exp = Math.floor(Date.now() / 1000) + expiresS;
  return `${base}/media/${key}?exp=${exp}&sig=${mediaSig(secret, key, exp)}`;
}

export function verifyMediaSig(secret: string, key: string, exp: unknown, sig: unknown): boolean {
  const e = Number(exp);
  if (!Number.isInteger(e) || e < Date.now() / 1000 || typeof sig !== 'string') return false;
  const want = Buffer.from(mediaSig(secret, key, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

const apiBase = (c: Config) => c.PUBLIC_BASE_URL.replace(/\/$/, '');

export class S3Storage implements Storage {
  readonly name = 's3';
  readonly delivery: 'cdn' | 'api';
  private s3: S3Client;
  private ready?: Promise<void>;
  constructor(private c: Config) {
    this.delivery = c.MEDIA_DELIVERY;
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
    if (this.delivery === 'api')
      return signMediaUrl(apiBase(this.c), this.c.JWT_SECRET, key, expiresS);
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
  async stream(key: string, range?: { start: number; end?: number }) {
    await this.ensureBucket();
    try {
      const r = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.c.S3_BUCKET,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end ?? ''}` : undefined,
        }),
      );
      const length = r.ContentLength ?? 0;
      // "bytes 0-99/12345"
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(r.ContentRange ?? '');
      return {
        body: r.Body as Readable,
        contentType: r.ContentType ?? 'application/octet-stream',
        length,
        total: m ? Number(m[3]) : length,
        range: m ? { start: Number(m[1]), end: Number(m[2]) } : undefined,
      };
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      if (name === 'InvalidRange') throw Object.assign(new Error('range'), { statusCode: 416 });
      throw e;
    }
  }
  async put(key: string, body: Buffer, contentType: string, opts: { public?: boolean } = {}) {
    await this.ensureBucket();
    // Served through the API, nothing needs to be public on the bucket (and GCS uniform access refuses ACLs).
    const viaCdn = opts.public && this.delivery === 'cdn';
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.c.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: viaCdn ? 'public-read' : undefined,
        CacheControl: opts.public ? 'public, max-age=31536000, immutable' : undefined,
      }),
    );
  }
  publicUrl(key: string) {
    const base = this.c.CDN_BASE_URL ?? `${this.c.S3_ENDPOINT}/${this.c.S3_BUCKET}`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }
}

/** In-memory storage for tests and for running without any S3 at all; served by the API's /media route. */
export class MemoryStorage implements Storage {
  readonly name = 'memory';
  readonly delivery = 'api' as const;
  objects = new Map<string, { body: Buffer; contentType: string }>();
  constructor(
    private base: string,
    private secret: string,
  ) {}
  async presignPut(key: string) {
    return `${this.base}/v1/media/upload/${encodeURIComponent(key)}`;
  }
  async presignGet(key: string, expiresS = 3600) {
    return signMediaUrl(this.base, this.secret, key, expiresS);
  }
  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }
  async stream(key: string, range?: { start: number; end?: number }) {
    const o = this.objects.get(key);
    if (!o) return null;
    const total = o.body.length;
    if (!range) return { body: o.body, contentType: o.contentType, length: total, total };
    if (range.start >= total) throw Object.assign(new Error('range'), { statusCode: 416 });
    const end = Math.min(range.end ?? total - 1, total - 1);
    const body = o.body.subarray(range.start, end + 1);
    return {
      body,
      contentType: o.contentType,
      length: body.length,
      total,
      range: { start: range.start, end },
    };
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
    : new MemoryStorage(apiBase(c), c.JWT_SECRET);
}
