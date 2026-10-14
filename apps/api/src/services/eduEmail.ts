import { createHash } from 'node:crypto';

/** Schools we verify. Their subdomains (cumc.columbia.edu, alumni.barnard.edu) count too. */
const SCHOOLS: Record<string, string> = { columbia: 'Columbia', barnard: 'Barnard' };

/** The 400 message; keep it in step with SCHOOLS. */
export const SCHOOL_EMAIL_HINT = 'Use your Columbia or Barnard email';

// Whole-domain match, so lookalikes (columbia.edu.evil.com, notcolumbia.edu, evil-columbia.edu) fail.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_RE = new RegExp(`^(?:${LABEL}\\.)*(${Object.keys(SCHOOLS).join('|')})\\.edu$`);
// What zod's email() allows in a local part, so nothing odd reaches the mail provider.
const LOCAL_RE = /^[a-z0-9_'.+-]+$/;

export interface EduEmail {
  /** Lowercased and trimmed, as typed (tag kept): the address the code is sent to. */
  address: string;
  campus: string;
  /** sha256 of the address without its +tag: what "one school email per account" compares. */
  hash: string;
}

/**
 * Accepts Columbia and Barnard addresses and returns where to send, the campus and the identity hash;
 * null for anything else. The domain is whatever follows the last "@".
 *
 * LionMail is Google Workspace, so uni+1@columbia.edu reaches the inbox of uni@columbia.edu and must
 * not count as a second address. Dots are not folded: that is Gmail behaviour we cannot assume here.
 */
export function parseEduEmail(raw: string): EduEmail | null {
  const address = raw.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at < 1 || address.length > 254) return null;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const school = DOMAIN_RE.exec(domain)?.[1];
  if (!school || !LOCAL_RE.test(local)) return null;
  const base = local.split('+')[0];
  if (!base) return null;
  return {
    address,
    campus: SCHOOLS[school]!,
    hash: createHash('sha256').update(`${base}@${domain}`).digest('hex'),
  };
}
