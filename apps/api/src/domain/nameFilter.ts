import { ApiError } from '@itp/shared';

/**
 * The name filter for usernames and plan names (App Store guideline 1.2). Plan names appear on the public /p/ page
 * and usernames on every profile. It is synchronous and has no dependencies on purpose: posts get Gemini
 * moderation, this is the cheap gate for short names.
 *
 * How a name is read: folded (no diacritics, lookalike letters mapped), split at anything that is not a letter or
 * digit, and single characters in a row are joined back into one word ("f.u.c.k", "n_a_z_1"). It is checked as
 * typed and with leetspeak undone (0 o, 1 i or l, 3 e, 4 a, 5 s, 7 t, @ a, $ s, and "!" inside a word as i). A
 * letter may be stretched to three or more ("shiiit"), and a doubled letter in a term stays doubled, so "ass" is
 * not "as" and "boner" is not "Bonner".
 *
 * To extend: add the term, lowercase letters only, to the right list and a case to test/nameFilter.test.ts.
 * - SEVERE terms almost never occur inside an innocent word, so they match anywhere in a word. A one- or
 *   two-letter word is glued to its neighbours first, which catches "fu.ck" and "sh it" without joining
 *   "Habit Chain". Before adding a term, think of "Essex", "Therapist", "Ignazio" and "Sporn": a term that can
 *   occur inside an ordinary word belongs in MILD.
 * - MILD terms match whole words only, with an optional plural s. Even "cunt" is here, for Scunthorpe. List other
 *   forms ("raped") as terms of their own. The cost: a compound with no separator ("bigdick") gets through, so
 *   list the compound in SEVERE when that is safe. Check that term + s is not a word ("asses" is "assess").
 * - ALLOWED holds the few real names that contain a MILD word. Every entry is a name that was wrongly refused.
 *   DISPLAY_ALLOWED is the same for display names only: a name that is fine there but reads as a slur as a handle.
 * - RESERVED names are against impersonation. For usernames any one part counts ("hermi_team"). For a display name
 *   only a name made of nothing but reserved, role and filler words counts ("Hermi Team", "The Hermi Team"), not
 *   "Hermione Granger", and school words alone are not enough ("Barnard" is a name, "Barnard Team" is not).
 *
 * A display name is a real person's name, so it is held to SEVERE and RESERVED only: MILD would refuse "Dick",
 * "Kike" or "Wank". The cost is that a rude whole word that is not in SEVERE ("Nazi") gets through as a display name.
 * test/nameFilter.test.ts keeps a table of real names from many places that must pass as display names; add a name
 * there before loosening a list for it.
 */

export type NameKind = 'username' | 'displayName' | 'planName';
/** Why a name failed. For logs and tests: never tell the user which word matched. */
export type NameCheck = { ok: true } | { ok: false; reason: 'severe' | 'mild' | 'reserved' };

const SEVERE = [
  // Slurs and hate
  'nigger',
  'nigga',
  'faggot',
  'tranny',
  'towelhead',
  'hitler',
  // Sexual
  'fuck',
  'pussy',
  'bitch',
  'asshole',
  'cocksucker',
  'dickhead',
  'shithead',
  'bullshit',
  'blowjob',
  'handjob',
  'dildo',
  'orgasm',
  'cumshot',
  'cumslut',
  'jizz',
  'gangbang',
  'bukkake',
  'hentai',
  'masturbat',
  // Abusive
  'pedophile',
  'paedophile',
];

const MILD = [
  // Inside innocent words: Scunthorpe, class, Hancock, Canal, Essex, Shiitake, Pen Island, Sporn, Ignazio
  'ass',
  'arse',
  'anal',
  'anus',
  'cock',
  'cum',
  'cunt',
  'dick',
  'shit',
  'shitty',
  'sex',
  'sexy',
  'sext',
  'tits',
  'titties',
  'twat',
  'wank',
  'wanker',
  'whore',
  'slut',
  'slutty',
  'boner',
  'horny',
  'milf',
  'penis',
  'vagina',
  'porn',
  'porno',
  'pornhub',
  'pornstar',
  'blow job',
  'hand job',
  'jerk off',
  'jackass',
  'dumbass',
  'fatass',
  'fck',
  'fcuk',
  // Slurs that are also names or words: Pakistan, raccoon, Spice, Ignazio
  'kkk', // not SEVERE: a glued "Ashok K Karmaker" would read it
  'nazi',
  'neonazi',
  'nazism',
  'kike',
  'chink',
  'spic',
  'gook',
  'coon',
  'paki',
  'fag',
  'dyke',
  'beaner',
  'retard',
  'retarded',
  // Violence. Inside Therapist, Grape, Prince Street
  'rape',
  'raped',
  'raping',
  'rapist',
  'molest',
  'molested',
  'molester',
  'incest',
  'pedo',
  'paedo',
  'kys',
  'kill yourself',
  'school shooter',
  'sieg heil',
  'white power',
];

/** Names that hold a MILD word and are fine. Removed before the whole-word check. */
const ALLOWED =
  /\b(?:cum laude|moby dick|dicks sporting goods|van dyke|maine coon|museum of sex)\b/g;
/**
 * Display names only, removed before the SEVERE check: "Tran Ny" is the Vietnamese surname Tran and the given name
 * Ny, and it glues into a slur. As a handle ("tran_ny") or a plan name it reads as the slur, so it stays refused
 * there; the cost here is that someone can type it to spell the slur.
 */
const DISPLAY_ALLOWED = /\btran ny\b/g;

/** Names that pass for a school. Alone they are a person or a place ("Barnard"); with a role word they are not. */
const SCHOOLS = ['columbia', 'columbiau', 'barnard'];
/** Names that pass for Hermi, the schools or app review. For usernames, matched as the whole name or any one part. */
const RESERVED = new Set([
  'hermi',
  'hermiapp',
  'admin',
  'administrator',
  'sysadmin',
  'support',
  'official',
  'moderator',
  'mod',
  'staff',
  'appreview',
  'applereview',
  'appstore',
  ...SCHOOLS,
]);
/** Words that make a reserved name only when glued to one: "hermiteam", "columbiauniversity". */
const TAILS = new Set(['team', 'app', 'hq', 'help', 'bot', 'news', 'university', 'safety']);
/**
 * Display names only, so not TAILS (which usernames glue): words that dress a reserved name up ("The Hermi Team",
 * "Team of Hermi", "Official Hermi Account") but do not make one. "The Rock" and "Theo" are not names that pass.
 */
const FILLER = new Set(['the', 'of', 'account', 'member']);

/** "shit" matches "shiiit" but not "shiit" (a real double letter), "ass" needs two s; "jerk off" may lose its space. */
const stretch = (term: string) =>
  term
    .split(' ')
    .map((w) =>
      w.replace(/(.)\1*/g, (run, c) =>
        run.length > 1 ? `${c}{${run.length},}` : `${c}(?:${c}{2,})?`,
      ),
    )
    .join(' ?');
const SEVERE_RE = new RegExp(SEVERE.map(stretch).join('|'));
const MILD_RE = new RegExp(`(?<![a-z])(?:${MILD.map(stretch).join('|')})s?(?![a-z])`);

const LEET: Record<string, string> = {
  '0': 'o',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};
/** Lowercase letters that NFKD leaves alone but that pass for Latin ones, by code point so they stay readable. */
const LOOKALIKE = new Map<string, string>(
  (
    [
      [0x0430, 'a'], // Cyrillic a
      [0x0435, 'e'], // Cyrillic e
      [0x043e, 'o'], // Cyrillic o
      [0x0440, 'p'], // Cyrillic er
      [0x0441, 'c'], // Cyrillic es
      [0x0445, 'x'], // Cyrillic ha
      [0x0443, 'y'], // Cyrillic u
      [0x0456, 'i'], // Cyrillic byelorussian i
      [0x0455, 's'], // Cyrillic dze
      [0x0458, 'j'], // Cyrillic je
      [0x03bf, 'o'], // Greek omicron
      [0x03b9, 'i'], // Greek iota
      [0x0131, 'i'], // dotless i
      [0x00df, 'ss'], // sharp s
      [0x00f8, 'o'], // o with stroke
      [0x00e6, 'ae'], // ae ligature
      [0x0142, 'l'], // l with stroke
      [0x0111, 'd'], // d with stroke
    ] as const
  ).map(([cp, letter]) => [String.fromCodePoint(cp), letter]),
);

const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}'\u2019`]/gu, '')
    .toLowerCase()
    .replace(/\P{ASCII}/gu, (c) => LOOKALIKE.get(c) ?? c)
    // Three of a letter already count as stretched; cutting longer runs keeps a long input from being slow.
    .replace(/([a-z0-9])\1{3,}/g, '$1$1$1');

/** Words of the folded text; single characters in a row are joined, so "f.u.c.k" is one word. */
function words(folded: string): string[] {
  const out: string[] = [];
  let run = '';
  for (const t of folded.split(/[^a-z0-9@$!]+/).filter(Boolean)) {
    if (t.length === 1) run += t;
    else {
      if (run) out.push(run);
      run = '';
      out.push(t);
    }
  }
  if (run) out.push(run);
  return out;
}

const letters = (s: string) => s.replace(/[^a-z]/g, '');
const leet = (word: string, one: string) =>
  word
    .replace(/(?<=[a-z0-9])!(?=[a-z0-9])/g, 'i')
    .replace(/[013457@$]/g, (c) => (c === '1' ? one : LEET[c]!));

/**
 * The letter-only words to check: as typed (digits dropped, so "dick69" reads "dick"), and with digits read as
 * letters. A word made of digits alone is never read as letters, or "Room 455" would say "ass".
 */
function readings(text: string): string[][] {
  const ws = words(fold(text));
  const spelled = ws.filter((w) => /[a-z]/.test(w));
  const all = [ws.map(letters), spelled.map((w) => letters(leet(w, 'i')))];
  if (spelled.some((w) => w.includes('1'))) all.push(spelled.map((w) => letters(leet(w, 'l'))));
  return all.map((r) => r.filter(Boolean));
}

/** The words, and each one- or two-letter word glued to its neighbours: "fu" "ck" is "fuck". */
function glued(ws: string[]): string[] {
  const out = [...ws];
  ws.forEach((w, i) => {
    if (w.length > 2) return;
    const [before, after] = [ws[i - 1] ?? '', ws[i + 1] ?? ''];
    out.push(before + w, w + after, before + w + after);
  });
  return out;
}

/** Usernames: the whole name, or any one part, is reserved, or two reserved or role words are glued ("hermiteam"). */
function isReserved(parts: string[]): boolean {
  const flat = parts.join('');
  if (RESERVED.has(flat) || parts.some((p) => RESERVED.has(p))) return true;
  const word = (s: string) => RESERVED.has(s) || TAILS.has(s);
  for (const r of RESERVED) {
    if (flat.startsWith(r) && word(flat.slice(r.length))) return true;
    if (flat.endsWith(r) && word(flat.slice(0, -r.length))) return true;
  }
  return false;
}

// What a display name has been split into: a reserved word that is not a school, a school, a role word.
const HARD = 1;
const SCHOOL = 2;
const ROLE = 4;
/** The words a display name can be made of, with what each one is. A reserved word also counts with a possessive s. */
const DISPLAY_WORDS: [string, number][] = [
  ...[...RESERVED].flatMap((w): [string, number][] => {
    const kind = SCHOOLS.includes(w) ? SCHOOL : HARD;
    return [
      [w, kind],
      [`${w}s`, kind], // "Hermi's" folds to "hermis"
    ];
  }),
  ...[...TAILS].map((w): [string, number] => [w, ROLE]),
  ...[...FILLER].map((w): [string, number] => [w, 0]),
];

/**
 * Display names: the whole name is made of reserved, role and filler words only, and it passes for Hermi or staff:
 * it has a reserved word that is not a school ("Hermi", "Admin", "Hermi's Team", "The Hermi Team"), or a school and a
 * role word ("Barnard Team", "Columbia University"). School words alone ("Barnard", "Columbia") are people and
 * places, and so are "Mod Patel", "Hermione Granger" and "The Rock".
 */
function isImpersonation(parts: string[]): boolean {
  const flat = parts.join('');
  // seen[i]: bit c is set when the first i letters split into words that add up to the kinds in c (HARD | SCHOOL | ROLE)
  const seen = Array<number>(flat.length + 1).fill(0);
  seen[0] = 1;
  for (let i = 1; i <= flat.length; i++)
    for (const [w, kind] of DISPLAY_WORDS) {
      const before = seen[i - w.length];
      if (!before || !flat.startsWith(w, i - w.length)) continue;
      for (let c = 0; c < 8; c++) if (before & (1 << c)) seen[i]! |= 1 << (c | kind);
    }
  for (let c = 0; c < 8; c++)
    if (seen[flat.length]! & (1 << c) && (c & HARD || (c & SCHOOL && c & ROLE))) return true;
  return false;
}

export function checkName(text: string, kind: NameKind): NameCheck {
  for (const parts of readings(text)) {
    let rest = parts.join(' ').replace(ALLOWED, ' ');
    if (kind === 'displayName') rest = rest.replace(DISPLAY_ALLOWED, ' ');
    if (glued(rest.split(' ').filter(Boolean)).some((w) => SEVERE_RE.test(w)))
      return { ok: false, reason: 'severe' };
    if (kind !== 'displayName' && MILD_RE.test(rest)) return { ok: false, reason: 'mild' };
    if (kind === 'username' && isReserved(parts)) return { ok: false, reason: 'reserved' };
    if (kind === 'displayName' && isImpersonation(parts)) return { ok: false, reason: 'reserved' };
  }
  return { ok: true };
}

const NOT_ALLOWED: Record<NameKind, string> = {
  username: 'Choose a different username',
  displayName: 'Choose a different name',
  planName: 'Choose a different name for this plan',
};

/** 400 NAME_NOT_ALLOWED. The message never says what matched. */
export function assertNameAllowed(text: string, kind: NameKind): void {
  if (!checkName(text, kind).ok) throw new ApiError(400, 'NAME_NOT_ALLOWED', NOT_ALLOWED[kind]);
}

/**
 * The name to show for a person on a public page or in a push or text to someone else. Names saved before the
 * filter, and Apple's sign-in name, were never checked: a bad name becomes "@username" if that passes, else `none`.
 * A missing name is treated the same way. `first` shows the first word of the name, checked on its own ("Hermi
 * Patel" is a person, "Hermi" is not); `handleFirst` prefers "@username" over the name.
 */
export function safeDisplayName(
  u: { name?: string | null; username?: string | null } | null | undefined,
  {
    none = 'A Hermi user',
    first = false,
    handleFirst = false,
  }: { none?: string; first?: boolean; handleFirst?: boolean } = {},
): string {
  const words = u?.name?.trim().split(/\s+/) ?? [];
  const name = first ? words[0] : words.join(' ');
  const shownName = name && checkName(name, 'displayName').ok ? name : undefined;
  const shownHandle =
    u?.username && checkName(u.username, 'username').ok ? `@${u.username}` : undefined;
  return (handleFirst ? (shownHandle ?? shownName) : (shownName ?? shownHandle)) ?? none;
}
