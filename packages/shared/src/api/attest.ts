import { z } from 'zod';

export const AttestChallengeResponse = z.object({ challenge: z.string(), expiresAt: z.string() });

export const AttestRegisterBody = z.object({
  keyId: z.string().min(8).describe('From DCAppAttestService.generateKey()'),
  attestation: z.string().describe('Base64 attestation object from attestKey(keyId, sha256(challenge))'),
  challenge: z.string(),
});
