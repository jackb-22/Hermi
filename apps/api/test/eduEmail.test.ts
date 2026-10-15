import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { parseEduEmail as parse, schoolEmailKey } from '../src/services/eduEmail.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const KEY = schoolEmailKey('a-test-secret-that-is-long-enough');
const parseEduEmail = (raw: string, key = KEY) => parse(raw, key);

describe('allowlist', () => {
  test.each([
    ['uni1234@columbia.edu', 'Columbia'],
    ['uni1234@barnard.edu', 'Barnard'],
    ['uni1234@cumc.columbia.edu', 'Columbia'],
    ['uni1234@tc.columbia.edu', 'Columbia'],
    ['uni1234@gsb.columbia.edu', 'Columbia'],
    ['uni1234@alumni.barnard.edu', 'Barnard'],
    ['uni1234@a.b.c.columbia.edu', 'Columbia'],
    ['uni1234@xn--80ak6aa92e.columbia.edu', 'Columbia'],
    ['Uni1234@COLUMBIA.EDU', 'Columbia'],
    ['  uni1234@columbia.edu\n', 'Columbia'],
    ["o'brien.j@columbia.edu", 'Columbia'],
  ])('%j passes as %s', (email, campus) => {
    expect(parseEduEmail(email)?.campus).toBe(campus);
  });

  test.each([
    // Lookalike domains.
    'uni@columbia.edu.evil.com',
    'uni@barnard.edu.evil.com',
    'uni@columbia.edu.com',
    'uni@notcolumbia.edu',
    'uni@evil-columbia.edu',
    'uni@columbia-edu.com',
    'uni@xcolumbia.edu',
    'uni@columbia.com',
    'uni@columbia.org',
    'uni@columbia',
    'uni@edu',
    // Another "@" muddying which part is the domain.
    'columbia.edu@evil.com',
    'uni@columbia.edu@evil.com',
    'uni@evil.com@columbia.edu',
    'a,b@evil.com,uni@columbia.edu',
    'uni@x.columbia.edu,b@evil.com',
    // Trailing dots, inner whitespace, empty labels, bad labels.
    'uni@columbia.edu.',
    'uni@columbia.edu .evil.com',
    'uni@columbia .edu',
    'uni@ columbia.edu',
    'uni@columbia.edu\n.evil.com',
    'uni@columbia.edu\u0000',
    'uni@.columbia.edu',
    'uni@x..columbia.edu',
    'uni@-x.columbia.edu',
    'uni@x-.columbia.edu',
    `uni@${'a'.repeat(64)}.columbia.edu`,
    // Not ASCII: Cyrillic a and c, a fullwidth name, an ideographic full stop.
    'uni@columbiа.edu',
    'uni@сolumbia.edu',
    'uni@ＣＯＬＵＭＢＩＡ.edu',
    'uni@columbia。edu',
    // Other schools, other providers, malformed.
    'uni@nyu.edu',
    'uni@mit.edu',
    'uni@cuny.edu',
    'uni@gmail.com',
    '@columbia.edu',
    'columbia.edu',
    '',
    '   ',
    '+tag@columbia.edu',
    `${'a'.repeat(250)}@columbia.edu`,
  ])('%j is refused', (email) => {
    expect(parseEduEmail(email)).toBeNull();
  });
});

describe('one identity per mailbox', () => {
  test('case, padding and a +tag all hash like the bare address', () => {
    const bare = parseEduEmail('uni1234@columbia.edu')!.hash;
    for (const e of [
      'uni1234@columbia.edu',
      'UNI1234@Columbia.EDU',
      ' uni1234@columbia.edu ',
      'uni1234+1@columbia.edu',
      'uni1234+housing+lion@columbia.edu',
      'Uni1234+@columbia.edu',
    ])
      expect(parseEduEmail(e)?.hash, e).toBe(bare);
  });

  test('different mailboxes and subdomains stay different', () => {
    const hashes = [
      'uni1234@columbia.edu',
      'uni1235@columbia.edu',
      'uni1234@barnard.edu',
      'uni1234@cumc.columbia.edu',
      'uni.1234@columbia.edu',
    ].map((e) => parseEduEmail(e)?.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  test('the code goes to the address as typed (tag kept, lowercased), never the raw string', () => {
    expect(parseEduEmail(' Uni1234+Lions@Columbia.EDU ')?.address).toBe(
      'uni1234+lions@columbia.edu',
    );
  });
});

describe('the hash is keyed', () => {
  const addr = 'uni1234@columbia.edu';

  test('the same key gives the same hash, however often and however the address is spelled', () => {
    const again = schoolEmailKey('a-test-secret-that-is-long-enough');
    expect(parseEduEmail(addr, again)?.hash).toBe(parseEduEmail(addr)?.hash);
    expect(parseEduEmail(' UNI1234+x@Columbia.edu ', again)?.hash).toBe(parseEduEmail(addr)?.hash);
  });

  test('another key gives another hash, for every address', () => {
    const other = schoolEmailKey('a-different-secret-of-similar-length');
    expect(other.equals(KEY)).toBe(false);
    for (const e of [addr, 'uni1235@columbia.edu', 'uni1234@barnard.edu'])
      expect(parseEduEmail(e, other)?.hash, e).not.toBe(parseEduEmail(e)?.hash);
  });

  test('it is not a plain SHA-256 of the address, so a guessed address cannot be checked against it', () => {
    const hash = parseEduEmail(addr)!.hash;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(sha(addr));
    expect(hash).not.toBe(sha(`${addr}${KEY.toString('hex')}`));
  });

  test('it is HMAC-SHA256 under an HKDF key from the secret, with the version label', () => {
    const key = Buffer.from(hkdfSync('sha256', 'some-secret', '', 'hermi school email v1', 32));
    expect(schoolEmailKey('some-secret').equals(key)).toBe(true);
    expect(parseEduEmail(addr, key)?.hash).toBe(
      createHmac('sha256', key).update(addr).digest('hex'),
    );
    // Not the signing secret itself.
    expect(schoolEmailKey('some-secret').toString()).not.toContain('some-secret');
    expect(key).toHaveLength(32);
  });
});
