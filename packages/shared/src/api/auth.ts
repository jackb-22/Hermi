import { z } from 'zod';
import { IdSchema } from './common.ts';

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

export const StudentStatus = z.enum(['current', 'alumni']);

/** The signed-in user's own view. Other users are seen through ProfileSchema (later). */
export const MeSchema = z
  .object({
    id: IdSchema,
    name: z.string().nullable(),
    username: z.string().nullable(),
    photoUrl: z.string().nullable(),
    photoReview: z
      .object({
        status: z.enum(['scanning', 'rejected']),
        reason: z.string().nullable(),
      })
      .nullable()
      .describe('A new photo being scanned (photoUrl is still the old one) or refused'),
    spriteUrl: z
      .string()
      .nullable()
      .describe('Deprecated, always null: everyone is the same hermit crab, bundled in the app'),
    verified: z.boolean(),
    campus: z.string().nullable(),
    gradYear: z.number().int().nullable(),
    studentStatus: StudentStatus.nullable(),
    is21: z.boolean(),
    ghostMode: z.boolean(),
    openToPlans: z.boolean(),
    tagId: z.string().nullable(),
    tasteDone: z.boolean(),
    createdAt: z.string(),
  })
  .meta({ id: 'Me' });

export const AuthResponse = z.object({
  token: z.string().describe('Bearer token for Authorization header; valid 30 days'),
  isNew: z.boolean(),
  user: MeSchema,
});

export const AppleAuthBody = z.object({
  identityToken: z.string().min(10).describe('identityToken from Sign in with Apple'),
  nonce: z
    .string()
    .min(16)
    .max(256)
    .describe(
      'The raw random nonce (not hashed). Set request.nonce to its SHA-256, lowercase hex, before showing the Apple sheet; Apple copies that hash into the identity token and we check it',
    ),
  authorizationCode: z
    .string()
    .min(1)
    .max(2048)
    .describe(
      "authorizationCode from the Apple credential, as a string. Single-use and valid 5 minutes: send it with the sign-in request; we trade it for Apple's refresh token",
    ),
  name: z.string().max(80).optional().describe('Full name; Apple only sends it on first sign-in'),
});

export const DevAuthBody = z.object({
  username: z.string().regex(USERNAME_RE),
  name: z.string().max(80).optional(),
});

export const EduStartBody = z.object({
  email: z
    .email()
    .describe(
      'A Columbia or Barnard address: columbia.edu, barnard.edu or a subdomain of either (cumc.columbia.edu). ' +
        'Anything else is 400 EDU_DOMAIN_NOT_ALLOWED. A +tag is ignored (uni+1@columbia.edu is uni@columbia.edu), ' +
        'and one school email verifies one account: another account holding it is 409 EDU_EMAIL_TAKEN. ' +
        'Sends are limited per account and per IP: 429 RATE_LIMITED.',
    ),
  gradYear: z.number().int().min(2000).max(2040),
});
export const EduStartResponse = z.object({
  sent: z.literal(true),
  campus: z.string(),
  expiresAt: z.string(),
  devCode: z.string().optional().describe('Only present on dev deployments'),
});
export const EduVerifyBody = z.object({ code: z.string().regex(/^\d{6}$/) });

export const PatchMeBody = z.object({
  name: z.string().min(1).max(80).optional(),
  username: z.string().regex(USERNAME_RE).optional(),
  photoKey: z
    .string()
    .max(300)
    .optional()
    .describe('Ignored; upload the photo with POST /me/photo'),
  ghostMode: z.boolean().optional(),
  openToPlans: z.boolean().optional(),
});

/** An APNs device token: hex of 32 to 100 bytes. Apple has said the length may change, so no fixed 64. */
export const APNS_TOKEN_RE = /^(?:[0-9a-f]{2}){32,100}$/i;

export const PushTokenBody = z.object({
  token: z
    .string()
    .regex(APNS_TOKEN_RE)
    .describe(
      'The APNs device token as hex (application(_:didRegisterForRemoteNotificationsWithDeviceToken:), each byte as two hex digits). ' +
        'Debug builds from Xcode give sandbox tokens, which only work against a server with APNS_SANDBOX=1.',
    ),
});
