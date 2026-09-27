import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config.ts';

/** AUTHENTIC · MANIPULATED (fake/synthetic) · UNKNOWN (could not evaluate). */
export type Verdict = 'AUTHENTIC' | 'MANIPULATED' | 'UNKNOWN';

export interface DetectionOutcome {
  verdict: Verdict;
  /** 0..1 likelihood of manipulation when the detector gives one. */
  score: number | null;
  raw: string;
}

/**
 * Deepfake detection for media from outside the camera (profile photos, reported posts). Upload once, then poll:
 * `result` is null while the scan is still running, so a job can retry without uploading again.
 */
export interface Detector {
  readonly name: string;
  readonly enabled: boolean;
  submit(data: Buffer, fileName: string): Promise<string>;
  result(requestId: string): Promise<DetectionOutcome | null>;
}

export const verdictOf = (status: string): Verdict =>
  ['MANIPULATED', 'FAKE', 'SYNTHETIC', 'SUSPICIOUS'].includes(status)
    ? 'MANIPULATED'
    : ['AUTHENTIC', 'REAL'].includes(status)
      ? 'AUTHENTIC'
      : 'UNKNOWN';

export class OffDetector implements Detector {
  readonly name = 'off';
  readonly enabled = false;
  async submit(): Promise<string> {
    throw new Error('Reality Defender is not configured');
  }
  async result(): Promise<DetectionOutcome | null> {
    throw new Error('Reality Defender is not configured');
  }
}

/** Deterministic stand-in for tests: bytes containing "SYNTHETIC-FACE" are manipulated; the first poll is pending. */
export class FakeDetector implements Detector {
  readonly name = 'fake';
  readonly enabled = true;
  private scans = new Map<string, { bad: boolean; polls: number }>();
  async submit(data: Buffer) {
    const id = `rd_${this.scans.size + 1}`;
    this.scans.set(id, { bad: data.includes('SYNTHETIC-FACE'), polls: 0 });
    return id;
  }
  async result(requestId: string) {
    const s = this.scans.get(requestId);
    if (!s) throw new Error(`unknown scan ${requestId}`);
    if (s.polls++ === 0) return null;
    return s.bad
      ? { verdict: 'MANIPULATED' as const, score: 0.97, raw: 'MANIPULATED' }
      : { verdict: 'AUTHENTIC' as const, score: 0.03, raw: 'AUTHENTIC' };
  }
}

/** Reality Defender through its TypeScript SDK (free tier: images and audio). */
export class RealityDefenderDetector implements Detector {
  readonly name = 'reality-defender';
  readonly enabled = true;
  private client: Promise<import('@realitydefender/realitydefender').RealityDefender>;
  constructor(apiKey: string) {
    this.client = import('@realitydefender/realitydefender').then(
      ({ RealityDefender }) => new RealityDefender({ apiKey }),
    );
  }

  async submit(data: Buffer, fileName: string) {
    // The SDK uploads from a path only.
    const dir = await mkdtemp(join(tmpdir(), 'itp-rd-'));
    try {
      const path = join(dir, fileName.replace(/[^\w.-]/g, '_'));
      await writeFile(path, data);
      const r = await (await this.client).upload({ filePath: path });
      return r.requestId;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async result(requestId: string) {
    const r = await (await this.client).getResult(requestId, {
      maxAttempts: 6,
      pollingInterval: 3000,
    });
    if (['ANALYZING', 'DOWNLOADING', 'PROCESSING'].includes(r.status)) return null;
    return { verdict: verdictOf(r.status), score: r.score, raw: r.status };
  }
}

export function createDetector(c: Config): Detector {
  return c.REALITY_DEFENDER_KEY
    ? new RealityDefenderDetector(c.REALITY_DEFENDER_KEY)
    : new OffDetector();
}
