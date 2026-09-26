import { ErrorEnvelope } from '@itp/shared/api';

/** Documents the standard error envelope for the given statuses. */
export const errs = (...statuses: number[]) => Object.fromEntries(statuses.map((s) => [s, ErrorEnvelope]));
