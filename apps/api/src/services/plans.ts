import { ApiError, type PinType, fromGeoJSONPoint, newId, toGeoJSONPoint } from '@itp/shared';
import type { PlanSchema, StopInput } from '@itp/shared/api';
import type { Db } from 'mongodb';
import type { z } from 'zod';
import type { Config } from '../config.ts';
import type { PlaceDoc } from '../db/placeTypes.ts';
import type { GeoPoint, UserDoc } from '../db/types.ts';
import {
  type Issue,
  type Mode,
  type SchedStop,
  assemble,
  clampStay,
  defaultStay,
  estimateLegMin,
  totals,
  validate,
} from '../domain/schedule.ts';
import { places, toPlace } from './places.ts';
import { publicUrl, users } from './users.ts';

export type Visibility = 'just_me' | 'invite' | 'friends' | 'find';
export type PlanStatus = 'draft' | 'planned' | 'active' | 'completed' | 'cancelled';
export type MemberStatus = 'invited' | 'joined' | 'declined' | 'requested';

export interface StopDoc {
  id: string;
  placeId?: string;
  slot?: { category: PinType; near: GeoPoint };
  stayMin: number;
  staySource: 'default' | 'ai' | 'user';
  stayReason?: string;
  legMode: Mode;
  legMin: number;
  legSource: 'estimate' | 'apple' | 'google';
  /** Identifies the leg (from→to:mode) its cached minutes belong to. */
  legKey?: string;
  arriveAt: Date;
  departAt: Date;
  done: boolean;
  checkinId?: string;
}

export interface GhostChangeDoc {
  id: string;
  kind: 'swap' | 'move' | 'add_stop' | 'remove_stop' | 'set_mode' | 'set_start' | 'set_stay';
  label: string;
  fromIndex?: number;
  toIndex?: number;
  stop?: z.infer<typeof StopInput>;
  stopId?: string;
  mode?: Mode;
  startAt?: string;
  stayMin?: number;
  sources?: { title: string; uri: string }[];
}

export interface PlanDoc {
  _id: string;
  hostId: string;
  name: string;
  nameIsDefault: boolean;
  startAt: Date;
  endBy?: Date;
  mode: Mode;
  visibility: Visibility;
  status: PlanStatus;
  stops: StopDoc[];
  members: { userId: string; status: MemberStatus; at: Date }[];
  ghostChanges: GhostChangeDoc[];
  shareToken: string;
  sourcePlanId?: string;
  imessageThreadId?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export const plans = (db: Db) => db.collection<PlanDoc>('plans');

export function nextQuarterHour(now: Date): Date {
  const q = 15 * 60_000;
  return new Date(Math.ceil((now.getTime() + 60_000) / q) * q);
}

export type PlacesById = Map<string, PlaceDoc>;

export async function loadPlaces(db: Db, ids: (string | undefined)[]): Promise<PlacesById> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const docs = await places(db).find({ _id: { $in: want } }).toArray();
  return new Map(docs.map((p) => [p._id, p]));
}

const stopLoc = (s: Pick<StopDoc, 'placeId' | 'slot'>, byId: PlacesById) => {
  const p = s.placeId ? byId.get(s.placeId) : undefined;
  if (p) return fromGeoJSONPoint(p.loc);
  if (s.slot) return fromGeoJSONPoint(s.slot.near);
  throw new ApiError(400, 'BAD_REQUEST', `Unknown place ${s.placeId}`);
};
const stopCategory = (s: Pick<StopDoc, 'placeId' | 'slot'>, byId: PlacesById): PinType =>
  (s.placeId ? byId.get(s.placeId)?.category : s.slot?.category) ?? 'food';

export function slotLabel(c: PinType): string {
  return `Pick a ${c === 'nature' ? 'nature' : c === 'culture' ? 'culture' : c} spot`;
}

/** Merge requested stops with existing ones: a stop keeps its AI stay length while its place is unchanged. */
export function normalizeStops(input: z.infer<typeof StopInput>[], existing: StopDoc[], mode: Mode, byId: PlacesById, now: Date): StopDoc[] {
  const prev = new Map(existing.map((s) => [s.id, s]));
  return input.map((s) => {
    if (s.placeId && !byId.has(s.placeId)) throw new ApiError(400, 'BAD_REQUEST', `Unknown place ${s.placeId}`);
    const old = s.id ? prev.get(s.id) : undefined;
    const samePlace = old && old.placeId === s.placeId && !s.slot;
    const category = s.placeId ? byId.get(s.placeId)!.category : s.slot!.category;
    const stay =
      s.stayMin !== undefined
        ? { stayMin: clampStay(s.stayMin), staySource: 'user' as const, stayReason: undefined }
        : samePlace
          ? { stayMin: old.stayMin, staySource: old.staySource, stayReason: old.stayReason }
          : { stayMin: defaultStay(category), staySource: 'default' as const, stayReason: undefined };
    return {
      id: old?.id ?? s.id ?? newId(),
      placeId: s.placeId,
      slot: s.slot ? { category: s.slot.category, near: toGeoJSONPoint(s.slot.near) } : undefined,
      ...stay,
      legMode: s.legMode ?? old?.legMode ?? mode,
      legMin: old?.legMin ?? 0,
      legSource: old?.legSource ?? 'estimate',
      legKey: old?.legKey,
      arriveAt: now,
      departAt: now,
      done: samePlace ? old.done : false,
      checkinId: samePlace ? old.checkinId : undefined,
    };
  });
}

const locKey = (l: { lat: number; lng: number }) => `${l.lat.toFixed(5)},${l.lng.toFixed(5)}`;
export const legKeyFor = (a: { lat: number; lng: number }, b: { lat: number; lng: number }, mode: Mode) => `${locKey(a)}->${locKey(b)}:${mode}`;

export function toSchedStops(stops: StopDoc[], byId: PlacesById): SchedStop[] {
  return stops.map((s) => {
    const p = s.placeId ? byId.get(s.placeId) : undefined;
    const category = stopCategory(s, byId);
    return {
      id: s.id,
      loc: stopLoc(s, byId),
      category,
      name: p?.name ?? slotLabel(category),
      stayMin: s.stayMin,
      legMode: s.legMode,
      legMin: s.legMin,
      hours: p?.hours,
      isSlot: !p,
    };
  });
}

/**
 * Instant recompute on every change: legs whose endpoints or mode changed fall back to the offline estimate,
 * cached provider ETAs are kept, then times are reassembled. The AI button upgrades the defaults.
 */
export function recompute(plan: PlanDoc, byId: PlacesById): { plan: PlanDoc; issues: Issue[] } {
  const sched = toSchedStops(plan.stops, byId);
  plan.stops.forEach((s, i) => {
    if (i === 0) {
      s.legMin = 0;
      s.legKey = undefined;
      return;
    }
    const key = legKeyFor(sched[i - 1]!.loc, sched[i]!.loc, s.legMode);
    if (s.legKey !== key) {
      s.legMin = estimateLegMin(sched[i - 1]!.loc, sched[i]!.loc, s.legMode);
      s.legSource = 'estimate';
      s.legKey = key;
    }
    sched[i]!.legMin = s.legMin;
  });
  const times = assemble(plan.startAt, sched);
  plan.stops.forEach((s, i) => {
    s.arriveAt = times[i]!.arriveAt;
    s.departAt = times[i]!.departAt;
  });
  return { plan, issues: validate(sched, times, plan.endBy) };
}

export function defaultName(stops: StopDoc[], byId: PlacesById): string {
  const first = stops.find((s) => s.placeId)?.placeId;
  const name = first ? byId.get(first)?.name : undefined;
  if (!name) return 'New plan';
  return stops.length > 1 ? `${name} + ${stops.length - 1} more` : name;
}

export async function getPlan(db: Db, id: string): Promise<PlanDoc> {
  const p = await plans(db).findOne({ _id: id });
  if (!p || p.status === 'cancelled') throw new ApiError(404, 'NOT_FOUND', 'No such plan');
  return p;
}

export const isMember = (p: PlanDoc, userId: string) => p.hostId === userId || p.members.some((m) => m.userId === userId && m.status === 'joined');

export function assertHost(p: PlanDoc, userId: string) {
  if (p.hostId !== userId) throw new ApiError(403, 'FORBIDDEN', 'Only the host can edit this plan');
}

export async function toPlanView(
  db: Db,
  config: Config,
  plan: PlanDoc,
  viewerId: string,
  opts: { byId?: PlacesById; issues?: Issue[]; pref?: number[] } = {},
): Promise<z.infer<typeof PlanSchema>> {
  const byId = opts.byId ?? (await loadPlaces(db, plan.stops.map((s) => s.placeId)));
  const issues = opts.issues ?? recompute(structuredClone(plan), byId).issues;
  const sched = toSchedStops(plan.stops, byId);
  const t = totals(sched, plan.stops);
  const memberDocs = plan.members.length
    ? await users(db).find({ _id: { $in: plan.members.map((m) => m.userId) } }).project<Pick<UserDoc, '_id' | 'name' | 'username' | 'spriteKey'>>({ name: 1, username: 1, spriteKey: 1 }).toArray()
    : [];
  const byUser = new Map(memberDocs.map((u) => [u._id, u]));
  return {
    id: plan._id,
    name: plan.name,
    hostId: plan.hostId,
    isHost: plan.hostId === viewerId,
    startAt: plan.startAt.toISOString(),
    endBy: plan.endBy?.toISOString() ?? null,
    mode: plan.mode,
    visibility: plan.visibility,
    status: plan.status,
    stops: plan.stops.map((s, i) => {
      const p = s.placeId ? byId.get(s.placeId) : undefined;
      return {
        id: s.id,
        index: i + 1,
        place: p ? toPlace(p, { pref: opts.pref }) : null,
        slot: s.slot ? { category: s.slot.category, near: fromGeoJSONPoint(s.slot.near) } : null,
        label: sched[i]!.name,
        stayMin: s.stayMin,
        staySource: s.staySource,
        stayReason: s.stayReason ?? null,
        legMode: i === 0 ? null : s.legMode,
        legMin: i === 0 ? null : s.legMin,
        legSource: i === 0 ? null : s.legSource,
        arriveAt: s.arriveAt.toISOString(),
        departAt: s.departAt.toISOString(),
        done: s.done,
        checkinId: s.checkinId ?? null,
      };
    }),
    members: plan.members.map((m) => {
      const u = byUser.get(m.userId);
      return { userId: m.userId, name: u?.name ?? null, username: u?.username ?? null, spriteUrl: publicUrl(config, u?.spriteKey), status: m.status };
    }),
    totals: { km: t.km, footKm: t.footKm, legMin: t.legMin, xpPreview: t.xpPreview, endsAt: t.endsAt?.toISOString() ?? null },
    issues,
    ghostChanges: plan.ghostChanges,
    shareUrl: `${config.PUBLIC_BASE_URL.replace(/\/$/, '')}/p/${plan.shareToken}`,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}
