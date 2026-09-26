import { randomBytes } from 'node:crypto';
import { ApiError, newId } from '@itp/shared';
import {
  FolderBody,
  FolderItemBody,
  FolderSchema,
  OkSchema,
  Paged,
  SaveBody,
  SavedItemSchema,
  SaveResponse,
  SavesQuery,
} from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authed, bearer } from '../plugins/auth.ts';
import { places, toPlace } from '../services/places.ts';
import {
  getPlan,
  loadPlaces,
  nextQuarterHour,
  type PlanDoc,
  plans,
  recompute,
  toPlanView,
} from '../services/plans.ts';
import { hydratePosts, posts } from '../services/posts.ts';
import { getUser } from '../services/users.ts';
import { errs } from './_util.ts';

type SaveType = 'place' | 'post' | 'plan';
interface SaveDoc {
  _id: string;
  userId: string;
  type: SaveType;
  refId: string;
  createdAt: Date;
}
interface FolderDoc {
  _id: string;
  ownerId: string;
  name: string;
  items: { type: SaveType; refId: string; addedAt: Date }[];
  createdAt: Date;
}

const IdParams = z.object({ id: z.string() });

export const saveRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config, clock } = app.ctx;
  const saves = () => db.collection<SaveDoc>('saves');
  const folders = () => db.collection<FolderDoc>('folders');

  const hydrate = async (userId: string, items: { type: SaveType; refId: string; at: Date }[]) => {
    const me = await getUser(db, userId);
    const byType = (t: SaveType) => items.filter((i) => i.type === t).map((i) => i.refId);
    const [pl, po, pn] = await Promise.all([
      places(db)
        .find({ _id: { $in: byType('place') } })
        .toArray(),
      posts(db)
        .find({ _id: { $in: byType('post') }, status: 'live' })
        .toArray(),
      plans(db)
        .find({ _id: { $in: byType('plan') }, status: { $ne: 'cancelled' } })
        .toArray(),
    ]);
    const placeMap = new Map(pl.map((p) => [p._id, toPlace(p, { pref: me.prefVector })]));
    const postMap = new Map((await hydratePosts(app.ctx, po)).map((p) => [p.id, p]));
    const planMap = new Map(
      await Promise.all(
        pn.map(
          async (p) =>
            [p._id, await toPlanView(db, config, p, userId, { pref: me.prefVector })] as const,
        ),
      ),
    );
    return items.flatMap((i) => {
      const place = i.type === 'place' ? placeMap.get(i.refId) : undefined;
      const post = i.type === 'post' ? postMap.get(i.refId) : undefined;
      const plan = i.type === 'plan' ? planMap.get(i.refId) : undefined;
      if (!place && !post && !plan) return [];
      return [
        {
          type: i.type,
          refId: i.refId,
          savedAt: i.at.toISOString(),
          place: place ?? null,
          post: post ?? null,
          plan: plan ?? null,
        },
      ];
    });
  };

  /** Saving someone else's plan copies it to your plans, ready to start. */
  const copyPlan = async (src: PlanDoc, userId: string): Promise<string> => {
    const now = clock.now();
    const copy: PlanDoc = {
      ...src,
      _id: newId(),
      hostId: userId,
      nameIsDefault: false,
      startAt: src.startAt > now ? src.startAt : nextQuarterHour(now),
      visibility: 'just_me',
      status: 'draft',
      stops: src.stops.map((s) => ({ ...s, id: newId(), done: false, checkinId: undefined })),
      members: [],
      ghostChanges: [],
      shareToken: randomBytes(9).toString('base64url'),
      sourcePlanId: src._id,
      imessageThreadId: undefined,
      createdAt: now,
      updatedAt: now,
      completedAt: undefined,
    };
    recompute(
      copy,
      await loadPlaces(
        db,
        copy.stops.map((s) => s.placeId),
      ),
    );
    await plans(db).insertOne(copy);
    return copy._id;
  };

  const addToFolder = async (userId: string, folderId: string, type: SaveType, refId: string) => {
    const r = await folders().updateOne(
      { _id: folderId, ownerId: userId, 'items.refId': { $ne: refId } },
      { $push: { items: { type, refId, addedAt: clock.now() } } },
    );
    if (!r.matchedCount && !(await folders().findOne({ _id: folderId, ownerId: userId })))
      throw new ApiError(404, 'NOT_FOUND', 'No such folder');
  };

  app.post(
    '/saves',
    {
      ...authed,
      schema: {
        tags: ['saves'],
        summary:
          'Save a place, post or plan to All saved (a bookmark, not a like). Saving earns 0 XP.',
        security: bearer,
        body: SaveBody,
        response: { 200: SaveResponse, ...errs(400, 401, 404) },
      },
    },
    async (req) => {
      const { type } = req.body;
      let { refId } = req.body;
      let copiedPlanId: string | null = null;
      const exists =
        type === 'place'
          ? await places(db).findOne({ _id: refId })
          : type === 'post'
            ? await posts(db).findOne({ _id: refId, status: 'live' })
            : await getPlan(db, refId);
      if (!exists) throw new ApiError(404, 'NOT_FOUND', `No such ${type}`);
      if (type === 'plan' && (exists as PlanDoc).hostId !== req.userId) {
        copiedPlanId = await copyPlan(exists as PlanDoc, req.userId);
        refId = copiedPlanId;
      }
      const now = clock.now();
      await saves().updateOne(
        { userId: req.userId, type, refId },
        { $setOnInsert: { _id: newId(), createdAt: now } },
        { upsert: true },
      );
      if (req.body.folderId) await addToFolder(req.userId, req.body.folderId, type, refId);
      const doc = (await saves().findOne({ userId: req.userId, type, refId }))!;
      const [saved] = await hydrate(req.userId, [{ type, refId, at: doc.createdAt }]);
      return { saved: saved!, copiedPlanId };
    },
  );

  app.delete(
    '/saves',
    {
      ...authed,
      schema: {
        tags: ['saves'],
        summary: 'Unsave (also removes it from every folder)',
        security: bearer,
        body: FolderItemBody,
        response: { 200: OkSchema },
      },
    },
    async (req) => {
      await saves().deleteOne({ userId: req.userId, type: req.body.type, refId: req.body.refId });
      await folders().updateMany(
        { ownerId: req.userId },
        { $pull: { items: { refId: req.body.refId } } },
      );
      return { ok: true as const };
    },
  );

  app.get(
    '/saves',
    {
      ...authed,
      schema: {
        tags: ['saves'],
        summary:
          'All saved (or one folder), newest first; each item carries a type badge. Saved places are the small flags on your map.',
        security: bearer,
        querystring: SavesQuery,
        response: { 200: Paged(SavedItemSchema), ...errs(401, 404) },
      },
    },
    async (req) => {
      let items: { type: SaveType; refId: string; at: Date }[];
      if (req.query.folderId) {
        const f = await folders().findOne({ _id: req.query.folderId, ownerId: req.userId });
        if (!f) throw new ApiError(404, 'NOT_FOUND', 'No such folder');
        items = [...f.items]
          .reverse()
          .map((i) => ({ type: i.type, refId: i.refId, at: i.addedAt }));
      } else {
        const docs = await saves()
          .find({ userId: req.userId, ...(req.query.type ? { type: req.query.type } : {}) })
          .sort({ createdAt: -1 })
          .limit(500)
          .toArray();
        items = docs.map((d) => ({ type: d.type, refId: d.refId, at: d.createdAt }));
      }
      if (req.query.type) items = items.filter((i) => i.type === req.query.type);
      return { items: await hydrate(req.userId, items), nextCursor: null };
    },
  );

  app.get(
    '/folders',
    {
      ...authed,
      schema: {
        tags: ['saves'],
        summary: 'Your folders (All saved is implicit, listed first by the app)',
        security: bearer,
        response: { 200: z.object({ items: z.array(FolderSchema), nextCursor: z.null() }) },
      },
    },
    async (req) => {
      const docs = await folders().find({ ownerId: req.userId }).sort({ createdAt: 1 }).toArray();
      return {
        items: docs.map((f) => ({
          id: f._id,
          name: f.name,
          count: f.items.length,
          createdAt: f.createdAt.toISOString(),
        })),
        nextCursor: null,
      };
    },
  );

  app.post(
    '/folders',
    {
      ...authed,
      schema: {
        tags: ['saves'],
        security: bearer,
        body: FolderBody,
        response: { 200: FolderSchema },
      },
    },
    async (req) => {
      const f: FolderDoc = {
        _id: newId(),
        ownerId: req.userId,
        name: req.body.name,
        items: [],
        createdAt: clock.now(),
      };
      await folders().insertOne(f);
      return { id: f._id, name: f.name, count: 0, createdAt: f.createdAt.toISOString() };
    },
  );

  app.patch(
    '/folders/:id',
    {
      ...authed,
      schema: {
        tags: ['saves'],
        security: bearer,
        params: IdParams,
        body: FolderBody,
        response: { 200: FolderSchema, ...errs(404) },
      },
    },
    async (req) => {
      const f = await folders().findOneAndUpdate(
        { _id: req.params.id, ownerId: req.userId },
        { $set: { name: req.body.name } },
        { returnDocument: 'after' },
      );
      if (!f) throw new ApiError(404, 'NOT_FOUND', 'No such folder');
      return {
        id: f._id,
        name: f.name,
        count: f.items.length,
        createdAt: f.createdAt.toISOString(),
      };
    },
  );

  app.delete(
    '/folders/:id',
    {
      ...authed,
      schema: {
        tags: ['saves'],
        summary: 'Delete a folder (its items stay in All saved)',
        security: bearer,
        params: IdParams,
        response: { 200: OkSchema },
      },
    },
    async (req) => {
      await folders().deleteOne({ _id: req.params.id, ownerId: req.userId });
      return { ok: true as const };
    },
  );

  app.post(
    '/folders/:id/items',
    {
      ...authed,
      schema: {
        tags: ['saves'],
        summary: 'Add to folder (also saves it)',
        security: bearer,
        params: IdParams,
        body: FolderItemBody,
        response: { 200: OkSchema, ...errs(404) },
      },
    },
    async (req) => {
      await addToFolder(req.userId, req.params.id, req.body.type, req.body.refId);
      await saves().updateOne(
        { userId: req.userId, type: req.body.type, refId: req.body.refId },
        { $setOnInsert: { _id: newId(), createdAt: clock.now() } },
        { upsert: true },
      );
      return { ok: true as const };
    },
  );

  app.delete(
    '/folders/:id/items',
    {
      ...authed,
      schema: {
        tags: ['saves'],
        security: bearer,
        params: IdParams,
        body: FolderItemBody,
        response: { 200: OkSchema },
      },
    },
    async (req) => {
      await folders().updateOne(
        { _id: req.params.id, ownerId: req.userId },
        { $pull: { items: { refId: req.body.refId } } },
      );
      return { ok: true as const };
    },
  );
};
