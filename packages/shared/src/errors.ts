/** Stable error codes; the app may switch on these. Append only. */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
  'USERNAME_TAKEN',
  'EDU_DOMAIN_NOT_ALLOWED',
  'EDU_CODE_INVALID',
  'EDU_CODE_EXPIRED',
  'ATTEST_FAILED',
  'TAG_INVALID',
  'CHECKIN_TOO_FAR',
  'CHECKIN_NO_DWELL',
  'CHECKIN_LOW_ACCURACY',
  'CHECKIN_RATE_LIMITED',
  'SESSION_NOT_ACTIVE',
  'MEDIA_HASH_MISMATCH',
  'MEDIA_OUT_OF_WINDOW',
  'MEDIA_TOO_FAR',
  'MEDIA_NOT_VERIFIED',
  'PROVIDER_UNAVAILABLE',
  'PHOTO_REJECTED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
