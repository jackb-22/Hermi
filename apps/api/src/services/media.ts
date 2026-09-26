import { ApiError, fromGeoJSONPoint } from '@itp/shared';
import type { MediaSchema } from '@itp/shared/api';
import type { Db } from 'mongodb';
import type pg from 'pg';
import type { z } from 'zod';
import type { Config } from '../config.ts';
import type { GeoPoint } from '../db/types.ts';
import type { Storage } from '../providers/storage.ts';
import { sessions } from './sessions.ts';

export const MEDIA_RADIUS_M = 150;
const AFTER_DEPARTURE_MS = 10 * 60_000;
const MAX_STAY_MS = 4 * 3600_000;
const EARLY_SLACK_MS = 2 * 60_000;

export interface MediaDoc {
  _id: string;
  userId: string;
  checkinId: string;
  placeId: string;
  kind: 'photo' | 'video' | 'audio';
  contentType: string;
  sha256: string;
  bytes: number;
  durationS?: number;
  key: string;
  status: 'pending' | 'verified' | 'rejected';
  rejectReason?: string;
  capturedAt: Date;
  at: GeoPoint;
  attested: boolean;
  pairedWith?: string;
  ambientId?: string;
  rendition?: { key: string; posterKey?: string; contentType: string };
  /** The original with a signed C2PA manifest embedded (public, unguessable key): the Content Credentials file. */
  c2pa?: { manifestKey: string; signedAt: Date; signer: string | null };
  posted: boolean;
  createdAt: Date;
  verifiedAt?: Date;
}

export const media = (db: Db) => db.collection<MediaDoc>('media');

export interface CheckinRow {
  id: string;
  time: Date;
  user_id: string;
  place_id: string;
  tier: 'gps' | 'tag';
  session_id: string | null;
  plan_id: string | null;
  attested: boolean;
}

export async function getCheckin(tiger: pg.Pool, id: string): Promise<CheckinRow | null> {
  const { rows } = await tiger.query<CheckinRow>(
    'select id, time, user_id, place_id, tier, session_id, plan_id, attested from checkins where id = $1 limit 1',
    [id],
  );
  return rows[0] ?? null;
}

/**
 * A capture counts for a check-in from check-in time until departure + 10 minutes. Departure is the next
 * check-in, else the session end, capped at 4 hours after arrival.
 */
export async function captureWindow(
  db: Db,
  tiger: pg.Pool,
  c: CheckinRow,
): Promise<{ from: Date; to: Date }> {
  const { rows } = await tiger.query<{ time: Date }>(
    'select time from checkins where user_id = $1 and time > $2 order by time limit 1',
    [c.user_id, c.time],
  );
  const s = c.session_id ? await sessions(db).findOne({ _id: c.session_id }) : null;
  const candidates = [
    c.time.getTime() + MAX_STAY_MS,
    rows[0]?.time.getTime(),
    s?.endedAt?.getTime(),
  ].filter((x): x is number => typeof x === 'number');
  return {
    from: new Date(c.time.getTime() - EARLY_SLACK_MS),
    to: new Date(Math.min(...candidates) + AFTER_DEPARTURE_MS),
  };
}

export function assertInWindow(w: { from: Date; to: Date }, t: Date) {
  if (t < w.from || t > w.to)
    throw new ApiError(
      400,
      'MEDIA_OUT_OF_WINDOW',
      'Captures only count while you are checked in (until 10 minutes after you leave)',
    );
}

export const extFor = (contentType: string) =>
  ({
    'image/jpeg': 'jpg',
    'image/heic': 'heic',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/mpeg': 'mp3',
  })[contentType] ?? 'bin';

export async function toMedia(
  m: MediaDoc,
  storage: Storage,
  config: Config,
  viewerId?: string,
): Promise<z.infer<typeof MediaSchema>> {
  const own = viewerId === m.userId;
  return {
    id: m._id,
    kind: m.kind,
    status: m.status,
    checkinId: m.checkinId,
    placeId: m.placeId,
    capturedAt: m.capturedAt.toISOString(),
    at: fromGeoJSONPoint(m.at),
    sha256: m.sha256,
    url: own && m.status !== 'pending' ? await storage.presignGet(m.key) : null,
    renditionUrl: m.rendition ? storage.publicUrl(m.rendition.key) : null,
    posterUrl: m.rendition?.posterKey ? storage.publicUrl(m.rendition.posterKey) : null,
    ambientId: m.ambientId ?? null,
    verifyUrl: `${config.PUBLIC_BASE_URL.replace(/\/$/, '')}/verify/${m.sha256}`,
    rejectReason: m.rejectReason ?? null,
  };
}
