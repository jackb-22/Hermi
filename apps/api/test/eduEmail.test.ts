import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { parseEduEmail } from '../src/services/eduEmail.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

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
    const bare = sha('uni1234@columbia.edu');
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
