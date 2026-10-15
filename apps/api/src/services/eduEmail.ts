import { createHmac, hkdfSync } from 'node:crypto';
import type { Config } from '../config.ts';

/** Schools we verify. Their subdomains (cumc.columbia.edu, alumni.barnard.edu) count too. */
const SCHOOLS: Record<string, string> = { columbia: 'Columbia', barnard: 'Barnard' };

/**
 * The campus of accounts verified through REVIEW_EMAIL (Apple's reviewers). It is never a school,
 * so no campus board is built for it and matching never pairs it with a student: use
 * isReviewCampus wherever campus decides who sees whom.
 */
export const REVIEW_CAMPUS = 'App Review';
export const isReviewCampus = (campus: string | null | undefined) => campus === REVIEW_CAMPUS;

/** The 400 message; keep it in step with SCHOOLS. */
export const SCHOOL_EMAIL_HINT = 'Use your Columbia or Barnard email';

// Whole-domain match, so lookalikes (columbia.edu.evil.com, notcolumbia.edu, evil-columbia.edu) fail.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_RE = new RegExp(`^(?:${LABEL}\\.)*(${Object.keys(SCHOOLS).join('|')})\\.edu$`);
// What zod's email() allows in a local part, so nothing odd reaches the mail provider.
const LOCAL_RE = /^[a-z0-9_'.+-]+$/;

/**
 * The key for the school-email hash, derived from JWT_SECRET with HKDF so the signing secret itself
 * keys nothing else. Built once from config and passed to parseEduEmail.
 *
 * The hash is keyed because a school address has little entropy: a plain SHA-256 would let anyone
 * who can read the database confirm that a given student has an account by hashing their address.
 * Rotating JWT_SECRET changes every hash, so stored ones stop matching and the
 * one-email-per-account rule resets for existing accounts (a student could verify a second
 * account). That is acceptable at our scale; old hashes stay until their accounts verify again or
 * are deleted.
 */
export const schoolEmailKey = (secret: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, '', 'hermi school email v1', 32));

export interface EduEmail {
  /** Lowercased and trimmed, as typed (tag kept): the address the code is sent to. */
  address: string;
  campus: string;
  /** HMAC-SHA256 (schoolEmailKey) of the address minus its +tag: what one-per-account compares. */
  hash: string;
}

/**
 * Accepts Columbia and Barnard addresses and returns where to send, the campus and the identity
 * hash (keyed with `key`; every caller must pass the same one); null for anything else. The domain
 * is whatever follows the last "@".
 *
 * LionMail is Google Workspace, so uni+1@columbia.edu reaches the inbox of uni@columbia.edu and must
 * not count as a second address. Dots are not folded: that is Gmail behaviour we cannot assume here.
 */
export function parseEduEmail(raw: string, key: Buffer): EduEmail | null {
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
    hash: createHmac('sha256', key).update(`${base}@${domain}`).digest('hex'),
  };
}

/**
 * The App Review code when `raw` is REVIEW_EMAIL, else null (also null while the path is off).
 * Compared trimmed and lowercased as parseEduEmail reads an address, but with no +tag folding:
 * only that exact address qualifies.
 */
export function reviewCodeFor(
  c: Pick<Config, 'REVIEW_EMAIL' | 'REVIEW_CODE'>,
  raw: string,
): string | null {
  if (!c.REVIEW_EMAIL || !c.REVIEW_CODE) return null;
  return raw.trim().toLowerCase() === c.REVIEW_EMAIL ? c.REVIEW_CODE : null;
}
