import { randomInt } from 'node:crypto';
import type { AppContext } from '../context.ts';
import type { UserDoc } from '../db/types.ts';
import { users } from './users.ts';

/** One handle per phone number or email however it was written: E.164 for phones, lowercase for emails. */
export function normalizeHandle(raw: string): string | null {
  const s = raw.trim();
  if (s.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (!s.startsWith('+') && digits.length === 10) return `+1${digits}`; // US number without the country code
  return `+${digits}`;
}

/** "+1•••••1234" / "m•••@gmail.com": enough to recognise, not enough to copy. */
export function maskHandle(h: string): string {
  if (h.includes('@')) {
    const [name, domain] = h.split('@');
    return `${name!.slice(0, 1)}•••@${domain}`;
  }
  return `${h.slice(0, 2)}${'•'.repeat(Math.max(0, h.length - 6))}${h.slice(-4)}`;
}

const links = (ctx: AppContext) =>
  ctx.db.collection<{ _id: string; userId: string; expiresAt: Date }>('imessage_links');
/** No 0/O, 1/I/L: codes get read off a screen and typed. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_TTL_MS = 10 * 60_000;

export async function newLinkCode(ctx: AppContext, userId: string) {
  const expiresAt = new Date(ctx.clock.now().getTime() + LINK_TTL_MS);
  for (;;) {
    const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    try {
      await links(ctx).deleteMany({ userId });
      await links(ctx).insertOne({ _id: code, userId, expiresAt });
      return { code, expiresAt };
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // Taken: draw again.
    }
  }
}

/**
 * "link ABC123" from a handle: the handle now belongs to that account (and to no other; texting the code proves
 * the phone is yours). The code is single-use.
 */
export async function linkByCode(
  ctx: AppContext,
  rawHandle: string,
  code: string,
): Promise<{ ok: true; user: UserDoc } | { ok: false; reason: 'expired' | 'bad_handle' }> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return { ok: false, reason: 'bad_handle' };
  const row = await links(ctx).findOneAndDelete({ _id: code.toUpperCase() });
  if (!row || row.expiresAt.getTime() < ctx.clock.now().getTime())
    return { ok: false, reason: 'expired' };
  return { ok: true, user: await attachHandle(ctx, row.userId, handle) };
}

export async function attachHandle(
  ctx: AppContext,
  userId: string,
  handle: string,
): Promise<UserDoc> {
  await users(ctx.db).updateMany(
    { imessageHandles: handle, _id: { $ne: userId } },
    { $pull: { imessageHandles: handle } },
  );
  const user = await users(ctx.db).findOneAndUpdate(
    { _id: userId },
    { $addToSet: { imessageHandles: handle } },
    { returnDocument: 'after' },
  );
  return user!;
}

export async function userByHandle(
  ctx: AppContext,
  rawHandle: string | null,
): Promise<UserDoc | null> {
  const handle = rawHandle ? normalizeHandle(rawHandle) : null;
  if (!handle) return null;
  return users(ctx.db).findOne({ imessageHandles: handle, deletedAt: { $exists: false } });
}

export function smsUrl(agentAddress: string | null, body: string): string | null {
  return agentAddress ? `sms:${agentAddress}&body=${encodeURIComponent(body)}` : null;
}
