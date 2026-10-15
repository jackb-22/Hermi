import { importPKCS8, SignJWT } from 'jose';

/**
 * ES256 developer token for Apple server APIs (Maps Server API, WeatherKit, APNs), minted from a .p8 key.
 * `ttlS: null` leaves out `exp` (APNs provider tokens carry only `iss` and `iat`); `issuedAt` is for tests.
 */
export async function appleDevToken(o: {
  teamId: string;
  keyId: string;
  privateKey: string;
  ttlS?: number | null;
  issuedAt?: Date;
  header?: Record<string, string>;
  sub?: string;
}) {
  const key = await importPKCS8(o.privateKey.replace(/\\n/g, '\n'), 'ES256');
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: o.keyId, ...o.header })
    .setIssuer(o.teamId)
    .setIssuedAt(o.issuedAt);
  if (o.ttlS !== null) jwt.setExpirationTime(`${o.ttlS ?? 1800}s`);
  if (o.sub) jwt.setSubject(o.sub);
  return jwt.sign(key);
}
