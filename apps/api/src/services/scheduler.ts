import { ApiError, newId } from '@itp/shared';
import type { StopInput } from '@itp/shared/api';
import type { z } from 'zod';
import type { AppContext } from '../context.ts';
import { moveItem, proposeFix } from '../domain/fixes.ts';
import { assemble, clampStay, type Issue } from '../domain/schedule.ts';
import { places } from './places.ts';
import {
  type GhostChangeDoc,
  legKeyFor,
  loadPlaces,
  normalizeStops,
  type PlacesById,
  type PlanDoc,
  recompute,
  toSchedStops,
} from './plans.ts';

const localArrival = (d: Date) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);

/**
 * The AI button, tap: code does the arithmetic and checks; the model only estimates stay lengths (5–240 min).
 * 1 legs (Apple Maps ETAs, Google fallback) · 2 opening hours · 3 stays (Gemini) · 4 assemble · 5 validate + one ghost fix · 6 refine transit legs.
 */
export async function schedulePlan(
  ctx: AppContext,
  plan: PlanDoc,
): Promise<{ plan: PlanDoc; issues: Issue[]; byId: PlacesById }> {
  const { providers, db } = ctx;
  let byId = await loadPlaces(
    db,
    plan.stops.map((s) => s.placeId),
  );

  // 2. Hours: fetched when a place enters a plan, cached on the place.
  await Promise.all(
    plan.stops.map(async (s) => {
      const p = s.placeId ? byId.get(s.placeId) : undefined;
      if (!p || p.hours) return;
      try {
        const h = await providers.hours.hours({
          name: p.name,
          loc: { lat: p.loc.coordinates[1], lng: p.loc.coordinates[0] },
          googlePlaceId: p.googlePlaceId,
        });
        if (h)
          await places(db).updateOne(
            { _id: p._id },
            { $set: { hours: h.hours, googlePlaceId: h.googlePlaceId } },
          );
      } catch (e) {
        console.warn(`[schedule] hours for ${p.name} failed: ${(e as Error).message}`);
      }
    }),
  );
  byId = await loadPlaces(
    db,
    plan.stops.map((s) => s.placeId),
  );

  // 3. Stay lengths for every stop the user has not set by hand.
  recompute(plan, byId);
  const sched = toSchedStops(plan.stops, byId);
  const want = plan.stops
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.staySource !== 'user')
    .map(({ s, i }) => ({
      id: s.id,
      name: sched[i]!.name,
      category: sched[i]!.category,
      arrival: localArrival(s.arriveAt),
    }));
  if (want.length) {
    const est = new Map((await providers.llm.stayLengths(want, {})).map((e) => [e.id, e]));
    for (const s of plan.stops) {
      const e = est.get(s.id);
      if (!e) continue;
      s.stayMin = clampStay(e.stayMin);
      s.stayReason = e.reason;
      s.staySource = providers.llm.name === 'fake' ? 'default' : 'ai';
    }
  }

  // 1. Legs: one ETA per leg with that leg's mode and projected departure time.
  const legs = async (onlyTransit: boolean) => {
    const cur = toSchedStops(plan.stops, byId);
    const times = assemble(plan.startAt, cur);
    await Promise.all(
      plan.stops.map(async (s, i) => {
        if (i === 0 || (onlyTransit && s.legMode !== 'transit')) return;
        const eta = await providers.eta.eta(
          cur[i - 1]!.loc,
          cur[i]!.loc,
          s.legMode,
          times[i - 1]!.departAt,
        );
        s.legMin = eta.minutes;
        s.legSource = eta.source;
        s.legKey = legKeyFor(cur[i - 1]!.loc, cur[i]!.loc, s.legMode);
      }),
    );
  };
  await legs(false);
  // 4. Assemble. 6. Transit ETAs depend on departure time, so recompute them once with the new times.
  recompute(plan, byId);
  await legs(true);
  const { issues } = recompute(plan, byId);

  // 5. Validate: failing rows turn red with one proposed fix as a ghost change.
  const fix = proposeFix(toSchedStops(plan.stops, byId), plan.startAt, plan.endBy, issues);
  plan.ghostChanges = fix
    ? [
        fix.kind === 'set_start'
          ? { id: newId(), kind: 'set_start', label: fix.label, startAt: fix.startAt.toISOString() }
          : {
              id: newId(),
              kind: fix.kind,
              label: fix.label,
              fromIndex: fix.fromIndex,
              toIndex: fix.toIndex,
            },
      ]
    : [];
  return { plan, issues, byId };
}

/** Accepting a ghost change applies it through the same code path as a manual edit. */
export async function applyGhostChange(
  ctx: AppContext,
  plan: PlanDoc,
  g: GhostChangeDoc,
): Promise<void> {
  const idx = (n?: number) => {
    if (n === undefined || n < 1 || n > plan.stops.length + (g.kind === 'add_stop' ? 1 : 0))
      throw new ApiError(
        400,
        'BAD_REQUEST',
        `Change ${g.id} points at a stop that no longer exists`,
      );
    return n - 1;
  };
  const byStop = (id?: string) => {
    const s = plan.stops.find((x) => x.id === id);
    if (!s)
      throw new ApiError(
        400,
        'BAD_REQUEST',
        `Change ${g.id} points at a stop that no longer exists`,
      );
    return s;
  };
  switch (g.kind) {
    case 'swap':
    case 'move':
      plan.stops = moveItem(plan.stops, idx(g.fromIndex), idx(g.toIndex));
      break;
    case 'set_start':
      plan.startAt = new Date(g.startAt!);
      break;
    case 'set_mode':
      if (g.stopId) byStop(g.stopId).legMode = g.mode!;
      else {
        plan.mode = g.mode!;
        for (const s of plan.stops) s.legMode = g.mode!;
      }
      break;
    case 'set_stay':
      Object.assign(byStop(g.stopId), { stayMin: clampStay(g.stayMin!), staySource: 'user' });
      break;
    case 'remove_stop':
      plan.stops = plan.stops.filter((s) => s.id !== byStop(g.stopId).id);
      break;
    case 'add_stop': {
      const input = g.stop as z.infer<typeof StopInput>;
      const byId = await loadPlaces(ctx.db, [input.placeId]);
      const [stop] = normalizeStops([input], [], plan.mode, byId, ctx.clock.now());
      plan.stops.splice(g.toIndex ? idx(g.toIndex) : plan.stops.length, 0, stop!);
      break;
    }
  }
}
