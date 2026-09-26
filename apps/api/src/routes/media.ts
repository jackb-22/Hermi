import { ApiError, fromGeoJSONPoint, haversineM, newId, toGeoJSONPoint } from '@itp/shared';
import { MediaListQuery, MediaSchema, PresignBody, PresignResponse } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { enqueue } from '../jobs/queue.ts';
import { attestGuard } from '../plugins/attest.ts';
import { authed, bearer, requireAuth } from '../plugins/auth.ts';
import { sha256Hex } from '../providers/storage.ts';
import {
  assertInWindow,
  captureWindow,
  extFor,
  getCheckin,
  MEDIA_RADIUS_M,
  type MediaDoc,
  media,
  toMedia,
} from '../services/media.ts';
import { places } from '../services/places.ts';
import { errs } from './_util.ts';

const IdParams = z.object({ id: z.string() });

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, tiger, config, clock, providers } = app.ctx;
  const storage = () => providers.storage;

  app.post(
    '/media/presign',
    {
      preHandler: [requireAuth, attestGuard],
      schema: {
        tags: ['media'],
        summary: 'Start an in-app capture upload (photo, ≤15 s clip, or 3 s ambient clip)',
        description:
          'Only captures made during an active check-in qualify; no camera-roll uploads. PUT the file to upload.url with upload.headers, then call /media/:id/commit.',
        security: bearer,
        body: PresignBody,
        response: { 200: PresignResponse, ...errs(400, 401, 403, 404) },
      },
    },
    async (req) => {
      const b = req.body;
      const c = await getCheckin(tiger, b.checkinId);
      if (!c || c.user_id !== req.userId) throw new ApiError(404, 'NOT_FOUND', 'No such check-in');
      assertInWindow(await captureWindow(db, tiger, c), new Date(b.capturedAt));
      if (b.pairedWith) {
        const photo = await media(db).findOne({
          _id: b.pairedWith,
          userId: req.userId,
          kind: 'photo',
        });
        if (!photo || b.kind !== 'audio')
          throw new ApiError(
            400,
            'BAD_REQUEST',
            'pairedWith must reference your photo and only an audio clip can be paired',
          );
      }
      const id = newId();
      const doc: MediaDoc = {
        _id: id,
        userId: req.userId,
        checkinId: c.id,
        placeId: c.place_id,
        kind: b.kind,
        contentType: b.contentType,
        sha256: b.sha256,
        bytes: b.bytes,
        durationS: b.durationS,
        key: `orig/${req.userId}/${id}.${extFor(b.contentType)}`,
        status: 'pending',
        capturedAt: new Date(b.capturedAt),
        at: toGeoJSONPoint({ lat: b.lat, lng: b.lng }),
        attested: req.attested,
        pairedWith: b.pairedWith,
        posted: false,
        createdAt: clock.now(),
      };
      await media(db).insertOne(doc);
      const expiresAt = new Date(clock.now().getTime() + 15 * 60_000).toISOString();
      const viaApi = config.MEDIA_UPLOAD_MODE === 'api' || storage().name === 'memory';
      const headers: Record<string, string> = { 'Content-Type': b.contentType };
      if (viaApi) headers.Authorization = req.headers.authorization ?? '';
      const url = viaApi
        ? `${config.PUBLIC_BASE_URL.replace(/\/$/, '')}/v1/media/${id}/upload`
        : await storage().presignPut(doc.key, b.contentType);
      const upload = { url, method: 'PUT' as const, headers, expiresAt };
      return { media: await toMedia(doc, storage(), config, req.userId), upload };
    },
  );

  // Upload through the API when S3 is not reachable from the phone. Raw bytes, any media type.
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: 80 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );
    scope.put(
      '/media/:id/upload',
      { preHandler: requireAuth, schema: { hide: true, params: IdParams } },
      async (req, reply) => {
        const m = await media(db).findOne({ _id: (req.params as { id: string }).id });
        if (!m || m.userId !== req.userId) throw new ApiError(404, 'NOT_FOUND', 'No such media');
        if (m.status !== 'pending') throw new ApiError(409, 'CONFLICT', 'Already committed');
        await storage().put(m.key, req.body as Buffer, m.contentType);
        return reply.status(200).send({ ok: true });
      },
    );
  });

  app.post(
    '/media/:id/commit',
    {
      preHandler: [requireAuth, attestGuard],
      schema: {
        tags: ['media'],
        summary:
          'Verify an uploaded capture: server re-hashes the bytes and checks time window and 150 m radius',
        security: bearer,
        params: IdParams,
        response: { 200: MediaSchema, ...errs(400, 401, 404, 409) },
      },
    },
    async (req) => {
      const m = await media(db).findOne({ _id: req.params.id });
      if (!m || m.userId !== req.userId) throw new ApiError(404, 'NOT_FOUND', 'No such media');
      if (m.status === 'verified') return toMedia(m, storage(), config, req.userId);
      const reject = async (
        code: 'MEDIA_HASH_MISMATCH' | 'MEDIA_OUT_OF_WINDOW' | 'MEDIA_TOO_FAR',
        msg: string,
      ) => {
        await media(db).updateOne(
          { _id: m._id },
          { $set: { status: 'rejected', rejectReason: code } },
        );
        throw new ApiError(400, code, msg);
      };
      const body = await storage().get(m.key);
      if (!body) throw new ApiError(409, 'CONFLICT', 'Upload the file before committing');
      if (sha256Hex(body) !== m.sha256)
        return reject('MEDIA_HASH_MISMATCH', 'File does not match the hash taken at capture');
      const c = await getCheckin(tiger, m.checkinId);
      try {
        assertInWindow(await captureWindow(db, tiger, c!), m.capturedAt);
      } catch (e) {
        return reject('MEDIA_OUT_OF_WINDOW', (e as Error).message);
      }
      const place = await places(db).findOne({ _id: m.placeId });
      if (
        place &&
        haversineM(fromGeoJSONPoint(m.at), fromGeoJSONPoint(place.loc)) > MEDIA_RADIUS_M
      ) {
        return reject(
          'MEDIA_TOO_FAR',
          `Captures must be taken within ${MEDIA_RADIUS_M} m of ${place.name}`,
        );
      }
      await media(db).updateOne(
        { _id: m._id },
        { $set: { status: 'verified', verifiedAt: clock.now(), bytes: body.length } },
      );
      if (m.pairedWith)
        await media(db).updateOne({ _id: m.pairedWith }, { $set: { ambientId: m._id } });
      await enqueue(app.ctx, 'process_media', { mediaId: m._id }, { dedupeKey: `media:${m._id}` });
      return toMedia((await media(db).findOne({ _id: m._id }))!, storage(), config, req.userId);
    },
  );

  app.get(
    '/media',
    {
      ...authed,
      schema: {
        tags: ['media'],
        summary: 'Your captures for a check-in or a session (for the recap)',
        security: bearer,
        querystring: MediaListQuery,
        response: { 200: z.object({ items: z.array(MediaSchema), nextCursor: z.null() }) },
      },
    },
    async (req) => {
      let checkinIds: string[] | undefined;
      if (req.query.sessionId) {
        const { rows } = await tiger.query<{ id: string }>(
          'select id from checkins where session_id = $1 and user_id = $2',
          [req.query.sessionId, req.userId],
        );
        checkinIds = rows.map((r) => r.id);
      } else if (req.query.checkinId) checkinIds = [req.query.checkinId];
      const docs = await media(db)
        .find({
          userId: req.userId,
          status: { $ne: 'rejected' },
          ...(checkinIds ? { checkinId: { $in: checkinIds } } : {}),
        })
        .sort({ capturedAt: 1 })
        .limit(200)
        .toArray();
      return {
        items: await Promise.all(docs.map((d) => toMedia(d, storage(), config, req.userId))),
        nextCursor: null,
      };
    },
  );
};
