import { ApiError, type ErrorCode } from '@itp/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';

const byStatus: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Every error leaves as {error:{code,message,details?}}. */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Request did not match schema', details: err.validation },
      });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err, issues: err.cause.issues }, 'response failed its own schema');
      return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Response serialization failed' } });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.status(status).send({
      error: { code: byStatus[status] ?? 'INTERNAL', message: status >= 500 ? 'Internal error' : err.message },
    });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.url}` } }),
  );
}
