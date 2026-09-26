import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import { HealthSchema } from '@itp/shared/api';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { AppContext } from './context.ts';
import { authPlugin } from './plugins/auth.ts';
import { registerErrorHandling } from './plugins/errors.ts';
import { describeProviders } from './providers/index.ts';
import { routes } from './routes/index.ts';
import { webRoutes } from './routes/web.ts';

export const API_VERSION = '0.1.0';

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: ctx.config.NODE_ENV === 'test' ? false : { level: ctx.config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.decorate('ctx', ctx);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  await app.register(cors, { origin: true });
  await app.register(authPlugin);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Incentivize the Physical API',
        version: API_VERSION,
        description:
          'Contract for the app. Conventions: ULID ids, ISO-8601 UTC times, {lat,lng} coordinates, meters, minutes. ' +
          'Errors are always {error:{code,message,details?}}. Unknown request fields are stripped. ' +
          'Every route is served at /v1/<path> and at the bare /<path>; only /v1 is documented. See CONTRACT.md.',
      },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });
  await app.register(scalar, { routePrefix: '/docs' });
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());

  app.get(
    '/health',
    { schema: { tags: ['meta'], response: { 200: HealthSchema, 503: HealthSchema } } },
    async (_req, reply) => {
      const [mongo, tiger] = await Promise.all([
        ctx.db.command({ ping: 1 }).then(() => true, () => false),
        ctx.tiger.query('select 1').then(() => true, () => false),
      ]);
      const body = { ok: mongo && tiger, version: API_VERSION, mongo, tiger, time: ctx.clock.now().toISOString(), providers: describeProviders(ctx.providers) };
      return reply.status(body.ok ? 200 : 503).send(body);
    },
  );

  // Documented under /v1; mirrored at the bare path (hidden) because the PDF's endpoint table has no prefix.
  const mount = (hidden: boolean): FastifyPluginAsync => async (scope) => {
    if (hidden) {
      scope.addHook('onRoute', (r) => {
        r.schema = { ...(r.schema ?? {}), hide: true };
      });
    }
    for (const plugin of routes) await scope.register(plugin);
  };
  await app.register(webRoutes);
  await app.register(mount(false), { prefix: '/v1' });
  await app.register(mount(true), { prefix: '' });

  return app;
}
