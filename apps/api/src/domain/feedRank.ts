/** rank(p) = (1 + 2·[friend]) · max(0.1, taste(u,p)) · e^(−d/2 km) · e^(−age/48 h) */
export function feedRank(o: {
  friend: boolean;
  taste: number;
  distanceM?: number;
  ageH: number;
}): number {
  const proximity = o.distanceM === undefined ? 1 : Math.exp(-o.distanceM / 2000);
  return (1 + (o.friend ? 2 : 0)) * Math.max(0.1, o.taste) * proximity * Math.exp(-o.ageH / 48);
}

export const FEED_DAILY_CAP = 30;
export const PLAN_EVERY = 5;

/** Every fifth card is a joinable plan while any remain, so plans never get buried. */
export function interleave<P, Q>(
  posts: P[],
  plans: Q[],
): ({ t: 'post'; v: P } | { t: 'plan'; v: Q })[] {
  const out: ({ t: 'post'; v: P } | { t: 'plan'; v: Q })[] = [];
  let pi = 0;
  let qi = 0;
  while (pi < posts.length || qi < plans.length) {
    if ((out.length + 1) % PLAN_EVERY === 0 && qi < plans.length)
      out.push({ t: 'plan', v: plans[qi++]! });
    else if (pi < posts.length) out.push({ t: 'post', v: posts[pi++]! });
    else out.push({ t: 'plan', v: plans[qi++]! }); // posts ran out: remaining plans still get shown
  }
  return out;
}
