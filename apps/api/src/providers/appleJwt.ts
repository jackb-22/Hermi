import { importPKCS8, SignJWT } from 'jose';

/** ES256 developer token for Apple server APIs (Maps Server API, WeatherKit), minted from a .p8 key. */
export async function appleDevToken(o: {
  teamId: string;
  keyId: string;
  privateKey: string;
  ttlS?: number;
  header?: Record<string, string>;
  sub?: string;
}) {
  const key = await importPKCS8(o.privateKey.replace(/\\n/g, '\n'), 'ES256');
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: o.keyId, ...o.header })
    .setIssuer(o.teamId)
    .setIssuedAt()
    .setExpirationTime(`${o.ttlS ?? 1800}s`);
  if (o.sub) jwt.setSubject(o.sub);
  return jwt.sign(key);
}
