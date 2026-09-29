import { newId } from '@itp/shared';
import type { AppContext } from '../context.ts';
import { assemble, estimateLegMin, type Mode } from '../domain/schedule.ts';
import {
  type GhostChangeDoc,
  legKeyFor,
  nextQuarterHour,
  type PlacesById,
  type PlanDoc,
  toSchedStops,
} from './plans.ts';

/** Walking beats waiting for a train up to here… */
export const WALK_MAX_MIN = 20;
/** …and past it, transit has to save at least this much to be worth it. */
export const TRANSIT_SAVES_MIN = 5;

export interface LegPlan {
  /** 1-based index of the stop this leg arrives at. */
  index: number;
  stopId: string;
  mode: Mode;
  minutes: number;
  source: 'estimate' | 'apple' | 'google';
}

type Eta = { minutes: number; source: LegPlan['source'] };

/** Walk unless it is long; then transit if it saves enough. Bike and car plans stay on their own mode. */
export function chooseMode(planMode: Mode, etas: Partial<Record<Mode, Eta>>): Mode {
  if (planMode === 'bike' || planMode === 'car') return planMode;
  const walk = etas.walk?.minutes ?? Number.POSITIVE_INFINITY;
  const transit = etas.transit?.minutes ?? Number.POSITIVE_INFINITY;
  if (walk <= WALK_MAX_MIN) return 'walk';
  return transit <= walk - TRANSIT_SAVES_MIN ? 'transit' : 'walk';
}

/**
 * "Space it out": real ETAs for every leg (walk and transit compared, Apple → Google → estimate), a mode per leg,
 * and a start that is not in the past. Code decides everything; the result is a list of ghost changes, so the
 * caller either shows them for Apply (the AI button) or applies them straight away (Photon).
 * Arrival times then follow from start + stays + legs (`assemble`), which is what spaces the stops.
 */
export async function planSpacing(
  ctx: AppContext,
  plan: PlanDoc,
  byId: PlacesById,
): Promise<{ changes: GhostChangeDoc[]; legs: LegPlan[] }> {
  const changes: GhostChangeDoc[] = [];
  const now = ctx.clock.now();
  let startAt = plan.startAt;
  if (startAt.getTime() < now.getTime()) {
    startAt = nextQuarterHour(now);
    changes.push({
      id: newId(),
      kind: 'set_start',
      label: 'Start at the next quarter hour: the start time has passed',
      startAt: startAt.toISOString(),
    });
  }
  const sched = toSchedStops(plan.stops, byId);
  const times = assemble(startAt, sched);
  const modes: Mode[] =
    plan.mode === 'bike' || plan.mode === 'car' ? [plan.mode] : ['walk', 'transit'];

  const legs = await Promise.all(
    plan.stops.slice(1).map(async (s, k): Promise<LegPlan> => {
      const i = k + 1;
      const from = sched[i - 1]!.loc;
      const to = sched[i]!.loc;
      const etas: Partial<Record<Mode, Eta>> = {};
      await Promise.all(
        modes.map(async (m) => {
          try {
            etas[m] = await ctx.providers.eta.eta(from, to, m, times[i - 1]!.departAt);
          } catch (e) {
            console.warn(`[spacing] ${m} eta failed: ${(e as Error).message}`);
            etas[m] = { minutes: estimateLegMin(from, to, m), source: 'estimate' };
          }
        }),
      );
      const mode = chooseMode(plan.mode, etas);
      return { index: i + 1, stopId: s.id, mode, ...etas[mode]! };
    }),
  );

  for (const leg of legs) {
    const s = plan.stops[leg.index - 1]!;
    if (s.legMode === leg.mode && s.legMin === leg.minutes && s.legSource === leg.source) continue;
    const name = sched[leg.index - 1]!.name;
    changes.push({
      id: newId(),
      kind: 'set_mode',
      label: `${MODE_LABEL[leg.mode]} ${leg.minutes} min to ${name}${leg.source === 'estimate' ? ' (est.)' : ''}`,
      stopId: s.id,
      mode: leg.mode,
      legMin: leg.minutes,
      legSource: leg.source,
      legKey: legKeyFor(sched[leg.index - 2]!.loc, sched[leg.index - 1]!.loc, leg.mode),
    });
  }
  return { changes, legs };
}

export const MODE_LABEL: Record<Mode, string> = {
  walk: 'Walk',
  transit: 'Transit',
  bike: 'Bike',
  car: 'Drive',
};

const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Walk 9 min → Transit 18 min · ends 6:40 PM", for the planner's reply and Photon's text. */
export function spacingSummary(plan: PlanDoc, legs: LegPlan[]): string {
  const last = plan.stops.at(-1);
  const hops = legs.map((l) => `${MODE_LABEL[l.mode]} ${l.minutes} min`).join(' → ');
  return `${hops}${last ? ` · ends ${clock.format(last.departAt)}` : ''}`;
}
