/** QR and NFC stickers carry the same URL: /c/ for venue tags, /t/ for personal tags. */
export type TagKind = 'venue' | 'personal';

export interface TagRef {
  kind: TagKind;
  id: string;
  k: string;
}

const PATH: Record<TagKind, string> = { venue: 'c', personal: 't' };

export function buildTagUrl(base: string, ref: TagRef): string {
  return `${base.replace(/\/$/, '')}/${PATH[ref.kind]}/${encodeURIComponent(ref.id)}?k=${encodeURIComponent(ref.k)}`;
}

/** Parses a scanned tag URL; host is not checked here (the secret is what authenticates). */
export function parseTagUrl(raw: string): TagRef | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const m = /^\/(c|t)\/([^/]+)\/?$/.exec(u.pathname);
  const k = u.searchParams.get('k');
  if (!m || !k) return null;
  return { kind: m[1] === 'c' ? 'venue' : 'personal', id: decodeURIComponent(m[2]!), k };
}
