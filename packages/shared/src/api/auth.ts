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
    spriteUrl: z.string().nullable(),
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
  name: z.string().max(80).optional().describe('Full name; Apple only sends it on first sign-in'),
});

export const DevAuthBody = z.object({
  username: z.string().regex(USERNAME_RE),
  name: z.string().max(80).optional(),
});

export const EduStartBody = z.object({
  email: z.email(),
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
  photoKey: z.string().max(300).optional().describe('Storage key returned by a profile-photo upload'),
  ghostMode: z.boolean().optional(),
  openToPlans: z.boolean().optional(),
});

export const PushTokenBody = z.object({ token: z.string().min(10).max(200) });
