import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { checkinWithMedia } from './fixtures/media.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

const planMsg = 'Choose a different name for this plan';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let host: Awaited<ReturnType<typeof devLogin>>;
let placeIds: string[];

beforeAll(async () => {
  t = await setupTestApp();
  placeIds = (
    await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Diner', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'Lawn', category: 'nature', at: offset(ORIGIN, 400, 0) }),
    ])
  ).map((p) => p._id);
  host = await devLogin(t.app, 'hostess');
});
afterAll(() => t.teardown());
afterEach(() => vi.restoreAllMocks());

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  t.app.inject({ method, url: `/v1${url}`, headers: host.headers, payload });
const newPlan = async (name?: string) =>
  (await call('POST', '/plans', { name, stops: placeIds.map((placeId) => ({ placeId })) })).json();
const setPlanName = (id: string, name: string) =>
  t.ctx.db.collection('plans').updateOne({ _id: id } as never, { $set: { name } });
const setUsername = (id: string, username: string) =>
  t.ctx.db.collection('users').updateOne({ _id: id } as never, { $set: { username } });
const setName = (id: string, name: string) =>
  t.ctx.db.collection('users').updateOne({ _id: id } as never, { $set: { name } });

const notAllowed = (res: { statusCode: number; json: () => unknown }, message: string) => {
  expect(res.statusCode).toBe(400);
  expect(res.json()).toEqual({ error: { code: 'NAME_NOT_ALLOWED', message } });
};

describe('PATCH /me username', () => {
  test('a refused username is 400 NAME_NOT_ALLOWED, says nothing about why, and changes nothing', async () => {
    for (const username of [
      'n_a_z_1',
      'f.u.c.k',
      'shiiit',
      'hermi_team',
      'columbia_official',
      'tran_ny',
    ])
      notAllowed(await call('PATCH', '/me', { username }), 'Choose a different username');
    expect((await call('GET', '/me')).json().username).toBe('hostess');
  });

  test('ordinary usernames and their neighbours pass', async () => {
    const r = await call('PATCH', '/me', { username: 'hancock_92' });
    expect(r.statusCode).toBe(200);
    expect(r.json().username).toBe('hancock_92');
    expect((await call('PATCH', '/me', { username: 'sussex.essex' })).json().username).toBe(
      'sussex.essex',
    );
  });

  test('other edits do not look at the username, and an unchanged one passes', async () => {
    const old = await devLogin(t.app, 'oldtimer');
    await setUsername(old.id, 'fuck_legacy');
    const patch = (payload: object) =>
      t.app.inject({ method: 'PATCH', url: '/v1/me', headers: old.headers, payload });
    expect((await patch({ ghostMode: true })).statusCode).toBe(200);
    // an account from before the filter keeps working while it sends its own username back
    const same = await patch({ username: 'fuck_legacy', openToPlans: true });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ username: 'fuck_legacy', openToPlans: true });
    // but it cannot pick another bad one
    notAllowed(await patch({ username: 'fuck_legacy2' }), 'Choose a different username');
  });
});

describe('PATCH /me name', () => {
  test('a refused name is 400 NAME_NOT_ALLOWED, says nothing about why, and changes nothing', async () => {
    const before = (await call('GET', '/me')).json().name;
    for (const name of [
      'f.u.c.k',
      'Fuck Face',
      'Hermi',
      'Hermi Support',
      'Official Hermi',
      'Admin',
      'Moderator',
      'The Hermi Team',
      "Hermi's Team",
      'Columbia University',
    ])
      notAllowed(await call('PATCH', '/me', { name }), 'Choose a different name');
    expect((await call('GET', '/me')).json().name).toBe(before);
  });

  test('real names pass, including ones a profanity list refuses', async () => {
    for (const name of [
      'Dick Cummings',
      'Phuc Nguyen',
      'Shitij Dikshit',
      'Hermione Granger',
      'Tran Ny',
      'Barnard',
    ]) {
      const r = await call('PATCH', '/me', { name });
      expect(r.statusCode, name).toBe(200);
      expect(r.json().name).toBe(name);
    }
  });

  test('other edits do not look at the name, and an unchanged one passes', async () => {
    const old = await devLogin(t.app, 'oldname');
    await setName(old.id, 'Official Hermi');
    const patch = (payload: object) =>
      t.app.inject({ method: 'PATCH', url: '/v1/me', headers: old.headers, payload });
    expect((await patch({ ghostMode: true })).statusCode).toBe(200);
    // an account from before the filter keeps working while it sends its own name back
    const same = await patch({ name: 'Official Hermi', openToPlans: true });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ name: 'Official Hermi', openToPlans: true });
    // but it cannot pick another bad one, and a good one replaces it
    notAllowed(await patch({ name: 'Hermi Support' }), 'Choose a different name');
    expect((await patch({ name: 'Maya Chen' })).json().name).toBe('Maya Chen');
  });

  test('a name and a username in one request are each checked', async () => {
    notAllowed(
      await call('PATCH', '/me', { name: 'Maya Chen', username: 'hermi_team' }),
      'Choose a different username',
    );
    notAllowed(
      await call('PATCH', '/me', { name: 'Hermi Team', username: 'maya_ok' }),
      'Choose a different name',
    );
    expect((await call('GET', '/me')).json().username).not.toBe('maya_ok');
  });
});

describe('plan names', () => {
  test('POST /plans refuses a bad name and creates nothing', async () => {
    notAllowed(await call('POST', '/plans', { name: 'f.u.c.k night' }), planMsg);
    expect((await call('GET', '/plans')).json().items).toEqual([]);
  });

  test('POST /plans keeps a good name and defaults a missing one', async () => {
    const named = await newPlan('Amsterdam Ave crawl');
    expect(named).toMatchObject({ name: 'Amsterdam Ave crawl' });
    // reserved usernames are not reserved plan names
    expect((await newPlan('Columbia Library Day')).name).toBe('Columbia Library Day');
    expect((await newPlan()).name).toBe('Diner + 1 more');
  });

  test('PATCH /plans/:id refuses a bad name and leaves the plan alone', async () => {
    const p = await newPlan('Brunch');
    notAllowed(await call('PATCH', `/plans/${p.id}`, { name: 'Shit show' }), planMsg);
    expect((await call('GET', `/plans/${p.id}`)).json().name).toBe('Brunch');
    expect((await call('PATCH', `/plans/${p.id}`, { name: 'Hancock Hall' })).json().name).toBe(
      'Hancock Hall',
    );
  });

  test('PATCH /plans/:id lets a plan from before the filter keep its name', async () => {
    const p = await newPlan('Brunch');
    await setPlanName(p.id, 'shit show');
    const later = new Date(Date.now() + 86_400_000).toISOString();
    const r = await call('PATCH', `/plans/${p.id}`, { name: 'shit show', startAt: later });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ name: 'shit show', startAt: later });
    notAllowed(await call('PATCH', `/plans/${p.id}`, { name: 'shit show 2' }), planMsg);
  });

  test('POST /plans/:id/save refuses a bad name before saving', async () => {
    const p = await newPlan();
    notAllowed(
      await call('POST', `/plans/${p.id}/save`, { name: 'Dick Night', visibility: 'friends' }),
      planMsg,
    );
    expect((await call('GET', `/plans/${p.id}`)).json()).toMatchObject({ status: 'draft' });
    const ok = await call('POST', `/plans/${p.id}/save`, {
      name: 'Dickinson Reading',
      visibility: 'friends',
    });
    expect(ok.json()).toMatchObject({ status: 'planned', name: 'Dickinson Reading' });
  });
});

describe('AI-suggested plan names', () => {
  test('a clean suggestion is returned as it is', async () => {
    const p = await newPlan();
    vi.spyOn(t.ctx.providers.llm, 'planName').mockResolvedValue('Pasta then a walk');
    expect((await call('GET', `/plans/${p.id}/name-suggestion`)).json()).toEqual({
      name: 'Pasta then a walk',
    });
  });

  test('a suggestion that fails the filter becomes the default name', async () => {
    const p = await newPlan();
    vi.spyOn(t.ctx.providers.llm, 'planName').mockResolvedValue('Fuck it Friday');
    expect((await call('GET', `/plans/${p.id}/name-suggestion`)).json()).toEqual({
      name: 'Diner + 1 more',
    });
  });

  test('Save without a name stores the fallback, not the bad suggestion', async () => {
    const p = await newPlan();
    vi.spyOn(t.ctx.providers.llm, 'planName').mockResolvedValue('n.i.g.g.a lounge');
    const saved = await call('POST', `/plans/${p.id}/save`, { visibility: 'just_me' });
    expect(saved.json()).toMatchObject({ status: 'planned', name: 'Diner + 1 more' });
  });

  test('when even the default would fail (a rude place name), it is "New plan"', async () => {
    const [rude] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Fuck Bar', category: 'drinks', at: offset(ORIGIN, 100, 0) }),
    ]);
    const p = (await call('POST', '/plans', { stops: [{ placeId: rude!._id }] })).json();
    vi.spyOn(t.ctx.providers.llm, 'planName').mockResolvedValue('Shit show');
    expect((await call('GET', `/plans/${p.id}/name-suggestion`)).json()).toEqual({
      name: 'New plan',
    });
  });
});

describe('GET /p/:token', () => {
  const page = async (p: { shareUrl: string }) => t.app.inject(`/p/${p.shareUrl.split('/p/')[1]}`);

  test('shows a good name and the host handle', async () => {
    const p = await newPlan('Amsterdam Ave crawl');
    await setUsername(host.id, 'maya_c');
    const r = await page(p);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<h1>Amsterdam Ave crawl</h1>');
    expect(r.body).toContain('(@maya_c)');
  });

  test('a stored name that fails the filter is replaced, in the title and the heading', async () => {
    const p = await newPlan('Brunch');
    await setPlanName(p.id, 'f.u.c.k night');
    const r = await page(p);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<h1>A plan on Hermi</h1>');
    expect(r.body).toContain('<title>A plan on Hermi</title>');
    expect(r.body).not.toMatch(/f\.u\.c\.k/i);
    // the rest of the page still renders
    expect(r.body).toContain('Diner');
  });

  test('a host username that fails the filter is left out', async () => {
    const p = await newPlan('Brunch');
    await setUsername(host.id, 'n_a_z_1');
    const r = await page(p);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Hosted by');
    expect(r.body).not.toContain('n_a_z_1');
    expect(r.body).not.toContain('(@');
  });

  test('Hosted by: the name and the handle, else the handle alone, else "someone"', async () => {
    const p = await newPlan('Brunch');
    await setUsername(host.id, 'maya_c');
    await setName(host.id, 'Maya Chen');
    expect((await page(p)).body).toContain('Hosted by Maya Chen (@maya_c)');
    // a name from before the filter that passes for the app is not printed; the handle stands in, once
    await setName(host.id, 'Hermi Team');
    const handleOnly = (await page(p)).body;
    expect(handleOnly).toContain('Hosted by @maya_c</p>');
    expect(handleOnly).not.toContain('Hermi Team');
    // a name that is profane, and a handle that is too
    await setName(host.id, 'Fuck Face');
    await setUsername(host.id, 'fuck_face');
    const neither = (await page(p)).body;
    expect(neither).toContain('Hosted by someone</p>');
    expect(neither).not.toMatch(/fuck/i);
  });
});

describe('GET /verify/:hash', () => {
  // One place per capture: a second check-in at the same place falls inside the cooldown
  const verifyPage = async (username: string, n: number) => {
    const at = offset(ORIGIN, 1000 + 300 * n, 0);
    const [place] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: `Verify ${n}`, category: 'food', at }),
    ]);
    await setUsername(host.id, username);
    const { media } = await checkinWithMedia(t.ctx, host.id, place!._id, at, ['photo']);
    await t.ctx.db
      .collection('media')
      .updateOne({ _id: media[0]!._id } as never, { $set: { posted: true } });
    const r = await t.app.inject(`/verify/${media[0]!.sha256}`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('VERIFIED IRL');
    return r.body;
  };
  const by = (body: string) => /<dt>By<\/dt><dd>(.*?)<\/dd>/.exec(body)?.[1];

  test('prints the author as @username', async () => {
    expect(by(await verifyPage('maya_c', 1))).toBe('@maya_c');
  });

  test('a username that fails the filter is not printed: "a verified user"', async () => {
    const body = await verifyPage('n_a_z_1', 2);
    expect(by(body)).toBe('a verified user');
    expect(body).not.toContain('n_a_z_1');
    // a name that passes for staff is not printed either
    expect(by(await verifyPage('hermi_team', 3))).toBe('a verified user');
  });
});
