import { importPKCS8, SignJWT } from 'jose';

/**
 * ES256 JWT signed with a .p8 key, for Apple server APIs: Maps and WeatherKit developer tokens, the Sign in with
 * Apple client secret (which also sets `aud`), and APNs provider tokens (`ttlS: null` leaves out `exp`; they carry
 * only `iss` and `iat`). `issuedAt` is for tests.
 */
export async function appleDevToken(o: {
  teamId: string;
  keyId: string;
  privateKey: string;
  ttlS?: number | null;
  issuedAt?: Date;
  header?: Record<string, string>;
  sub?: string;
  audience?: string;
}) {
  const key = await importPKCS8(o.privateKey.replace(/\\n/g, '\n'), 'ES256');
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: o.keyId, ...o.header })
    .setIssuer(o.teamId)
    .setIssuedAt(o.issuedAt);
  if (o.ttlS !== null) jwt.setExpirationTime(`${o.ttlS ?? 1800}s`);
  if (o.sub) jwt.setSubject(o.sub);
  if (o.audience) jwt.setAudience(o.audience);
  return jwt.sign(key);
}
