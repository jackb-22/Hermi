import { assemble, estimateLegMin, type Issue, type SchedStop, validate } from './schedule.ts';

export type Fix =
  | { kind: 'swap' | 'move'; fromIndex: number; toIndex: number; label: string }
  | { kind: 'set_start'; startAt: Date; label: string };

const hoursIssue = (i: Issue) =>
  i.code === 'CLOSES_BEFORE_STAY_ENDS' || i.code === 'OPENS_AFTER_ARRIVAL';

export function moveItem<T>(xs: T[], from: number, to: number): T[] {
  const out = [...xs];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

/** Legs re-estimated after a reorder so candidate orders are compared fairly. */
function relegged(stops: SchedStop[]): SchedStop[] {
  return stops.map((s, i) =>
    i === 0
      ? { ...s, legMin: 0 }
      : { ...s, legMin: estimateLegMin(stops[i - 1]!.loc, s.loc, s.legMode) },
  );
}

const NY_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
});
const fmtTime = (d: Date) => NY_TIME.format(d).replace(':00', '').toLowerCase();

/**
 * One proposed fix for the first failing row, rendered as a ghost change (never applied silently):
 * try every other position for a stop with an hours problem, else shift the start for an end-time overrun.
 */
export function proposeFix(
  stops: SchedStop[],
  startAt: Date,
  endBy: Date | undefined,
  issues: Issue[],
): Fix | null {
  const first = issues.find(hoursIssue);
  if (first) {
    const from = stops.findIndex((s) => s.id === first.stopId);
    let best: { to: number; bad: number } | null = null;
    for (let to = 0; to < stops.length; to++) {
      if (to === from) continue;
      const order = relegged(moveItem(stops, from, to));
      const bad = validate(order, assemble(startAt, order), endBy).filter(hoursIssue).length;
      if (bad < issues.filter(hoursIssue).length && (!best || bad < best.bad)) best = { to, bad };
    }
    if (best) {
      const s = stops[from]!;
      const order = relegged(moveItem(stops, from, best.to));
      const arrive = assemble(startAt, order)[best.to]!.arriveAt;
      const adjacent = Math.abs(best.to - from) === 1;
      const verb = adjacent
        ? `Swap ${Math.min(from, best.to) + 1} and ${Math.max(from, best.to) + 1}`
        : `Move ${s.name} to stop ${best.to + 1}`;
      const why =
        first.code === 'CLOSES_BEFORE_STAY_ENDS'
          ? `to reach ${s.name} by ${fmtTime(arrive)}`
          : `so ${s.name} is open when you arrive`;
      return {
        kind: adjacent ? 'swap' : 'move',
        fromIndex: from + 1,
        toIndex: best.to + 1,
        label: `${verb} ${why}`,
      };
    }
  }
  const over = issues.find((i) => i.code === 'ENDS_AFTER_END_TIME');
  if (over && endBy) {
    const end = assemble(startAt, stops).at(-1)!.departAt;
    const minutes = Math.ceil((end.getTime() - endBy.getTime()) / 60_000 / 5) * 5;
    const newStart = new Date(startAt.getTime() - minutes * 60_000);
    return {
      kind: 'set_start',
      startAt: newStart,
      label: `Start ${minutes} min earlier to finish by ${fmtTime(endBy)}`,
    };
  }
  return null;
}
