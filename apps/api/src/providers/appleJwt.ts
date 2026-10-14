import { importPKCS8, SignJWT } from 'jose';

/**
 * ES256 JWT signed with a .p8 key, for Apple server APIs: Maps and WeatherKit developer tokens, and the
 * Sign in with Apple client secret (which also sets `aud`).
 */
export async function appleDevToken(o: {
  teamId: string;
  keyId: string;
  privateKey: string;
  ttlS?: number;
  header?: Record<string, string>;
  sub?: string;
  audience?: string;
}) {
  const key = await importPKCS8(o.privateKey.replace(/\\n/g, '\n'), 'ES256');
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: o.keyId, ...o.header })
    .setIssuer(o.teamId)
    .setIssuedAt()
    .setExpirationTime(`${o.ttlS ?? 1800}s`);
  if (o.sub) jwt.setSubject(o.sub);
  if (o.audience) jwt.setAudience(o.audience);
  return jwt.sign(key);
}
