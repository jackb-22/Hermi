import type { XpKind } from '@itp/shared';
import type pg from 'pg';

export interface XpRow {
  kind: XpKind;
  xp: number;
  refId?: string;
  label: string;
}

const LABELS: Record<XpKind, string> = {
  checkin_gps: 'Check-in',
  checkin_tag: 'Tag check-in',
  first_visit: 'First visit',
  tiles: 'New tiles',
  distance: 'Distance on foot',
  completed_plan: 'Plan completed',
  full_party: 'Full party',
  new_person: 'Someone new',
};
export const xpLabel = (k: XpKind) => LABELS[k];

/** XP is an append-only event log in Tiger; Score and ranks read the xp_daily rollup. */
export async function awardXp(tiger: pg.Pool | pg.PoolClient, userId: string, campus: string | undefined, time: Date, rows: XpRow[]) {
  const live = rows.filter((r) => r.xp > 0);
  if (!live.length) return;
  await tiger.query(
    `insert into xp_events (time, user_id, campus, kind, xp, ref_id)
     select $1, $2, $3, kind, xp, ref from unnest($4::text[], $5::int[], $6::text[]) as u(kind, xp, ref)`,
    [time, userId, campus ?? null, live.map((r) => r.kind), live.map((r) => r.xp), live.map((r) => r.refId ?? null)],
  );
}
