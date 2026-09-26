import { TAG_DIMS, tagIndex } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildPrefs } from '../src/domain/prefs.ts';
import { norm, tasteMatch, violatesDislikes } from '../src/domain/taste.ts';
import { devLogin, setupTestApp } from './helpers.ts';

describe('buildPrefs', () => {
  test('likes and dislikes move tag dimensions; vector is unit length', () => {
    const p = buildPrefs(
      [
        { cardId: 'live_jazz', liked: true },
        { cardId: 'museums', liked: true },
        { cardId: 'karaoke', liked: false },
      ],
      false,
    );
    expect(p.prefVector).toHaveLength(TAG_DIMS);
    expect(norm(p.prefVector)).toBeCloseTo(1);
    expect(p.prefVector[tagIndex('live_jazz')]).toBeGreaterThan(0);
    expect(p.prefVector[tagIndex('karaoke')]).toBeLessThan(0);
    expect(p.dislikes.tags).toContain('karaoke');
    expect(p.dislikes.tags).not.toContain('indoor'); // vibe tags never hard-filter
  });

  test('a category is disliked only when every shown card of it was swiped left', () => {
    const p = buildPrefs(
      [
        { cardId: 'pickup_basketball', liked: false },
        { cardId: 'climbing_gyms', liked: false },
        { cardId: 'live_jazz', liked: false },
        { cardId: 'karaoke', liked: true },
      ],
      false,
    );
    expect(p.dislikes.categories).toEqual(['sports']);
  });

  test('21+ cards are ignored for under-21 users', () => {
    const p = buildPrefs([{ cardId: 'rooftop_bars', liked: true }], false);
    expect(norm(p.prefVector)).toBe(0);
    expect(buildPrefs([{ cardId: 'rooftop_bars', liked: true }], true).likedTags).toContain('rooftop_bar');
  });

  test('taste match and dislike filter', () => {
    const p = buildPrefs([{ cardId: 'coffee_mornings', liked: true }], false);
    expect(tasteMatch(p.prefVector, ['coffee'])).toBeGreaterThan(tasteMatch(p.prefVector, ['pizza']));
    expect(violatesDislikes({ categories: ['sports'], tags: [] }, 'sports', [])).toBe(true);
    expect(violatesDislikes({ categories: [], tags: ['karaoke'] }, 'music', ['karaoke', 'indoor'])).toBe(true);
  });
});

describe('routes', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(() => t.teardown());

  test('deck is public, taste marks onboarding done and sets is21', async () => {
    const deck = await t.app.inject('/v1/onboarding/deck');
    expect(deck.json().cards).toHaveLength(16);
    const u = await devLogin(t.app, 'taster');
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/me/taste',
      headers: u.headers,
      payload: { is21: true, swipes: [{ cardId: 'rooftop_bars', liked: true }, { cardId: 'karaoke', liked: false }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ user: { tasteDone: true, is21: true }, dislikes: { tags: ['karaoke'] } });
    const doc = await t.ctx.db.collection('users').findOne({ _id: u.id } as never);
    expect(doc?.prefVector).toHaveLength(TAG_DIMS);
  });
});
