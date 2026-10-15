import { ApiError } from '@itp/shared';
import { describe, expect, test } from 'vitest';
import {
  assertNameAllowed,
  checkName,
  type NameKind,
  safeDisplayName,
} from '../src/domain/nameFilter.ts';
import { GeminiLlm } from '../src/providers/llm.ts';

const reason = (text: string, kind: NameKind = 'planName') => {
  const r = checkName(text, kind);
  return r.ok ? 'ok' : r.reason;
};

describe('normalizing', () => {
  test.each([
    ['n_a_z_1', 'mild'], // separators between single letters, 1 read as i
    ['N.A.Z.1', 'mild'],
    ['f.u.c.k', 'severe'],
    ['F U C K', 'severe'],
    ['f_uck', 'severe'], // a one-letter piece is glued to its neighbour
    ['fu.ck', 'severe'], // so is a two-letter one
    ['shiiit', 'mild'], // stretched
    ['fuuuuck', 'severe'],
    ['sh!t', 'mild'], // ! inside a word is an i
    ['$h1t', 'mild'], // $ is s, 1 is i
    ['a$$', 'mild'],
    ['@ss', 'mild'],
    ['5h17', 'mild'],
    ['n1gg3r', 'severe'], // 1 as i, 3 as e
    ['n1gger', 'severe'],
    ['ＦＵＣＫ', 'severe'], // full-width (NFKD)
    ['fuсk', 'severe'], // a Cyrillic с
    ['fu​ck', 'severe'], // a zero-width space inside
    ['FÜCK', 'severe'], // diacritics
    ['dick69', 'mild'], // numbers after a word
    ['big_dick', 'mild'],
    ['ass_hole', 'mild'],
    ['Jerk Off Night', 'mild'],
    ['jerkoff', 'mild'],
    ['kill yourself', 'mild'],
    ['K.Y.S', 'mild'],
    ['Nazi', 'mild'],
    ['KKK', 'mild'],
    ['xx_fuck_xx', 'severe'],
    ['motherfucker', 'severe'],
  ])('%s is refused (%s)', (text, why) => {
    expect(reason(text)).toBe(why);
    expect(reason(text, 'username')).toBe(why);
  });

  test('a doubled letter in a term stays doubled', () => {
    // "ass" is not "as"; "boner" is not "Bonner"; "rape" is not "rapped"
    for (const ok of ['as', 'Bonner', 'Rapped Up', 'Assess', 'Shiit'])
      expect(reason(ok)).toBe('ok');
  });

  test('digits alone are never read as letters', () => {
    // 4-5-5 is "ass" in leetspeak, but it is a room number
    for (const ok of ['Room 455', 'jack_455', 'Route 7175', 'Class of 2027', 'COMS 4156'])
      expect(reason(ok, 'username')).toBe('ok');
    expect(reason('a55')).toBe('mild');
  });

  test('a very long run of one letter is not slow', () => {
    expect(reason('a'.repeat(100_000))).toBe('ok');
    expect(reason(`${'s'.repeat(100_000)}h`)).toBe('ok');
    // and stretching is still seen
    expect(reason(`${'f'.repeat(50)}uck`)).toBe('severe');
  });

  test('empty and non-Latin names pass', () => {
    for (const ok of ['', '   ', '周末', '🍜🍜', 'مرحبا']) expect(reason(ok)).toBe('ok');
  });
});

describe('the three lists', () => {
  test('severe terms match inside a word', () => {
    for (const bad of [
      'xxfuckxx',
      'bullshit',
      'dickhead69',
      'cocksucker',
      'pussyslayer',
      'bigbitch',
    ])
      expect(reason(bad)).toBe('severe');
  });

  test('mild terms match whole words only, with a plural', () => {
    for (const bad of ['sex', 'Sex Night', 'sexy', 'a cunt', 'cunts', 'dicks', 'big tits', 'porn'])
      expect(reason(bad)).toBe('mild');
    // not as part of a word
    for (const ok of ['Sussex', 'Essex', 'Middlesex', 'Scunthorpe', 'Hancock', 'cocktail bar'])
      expect(reason(ok)).toBe('ok');
  });

  test('reserved names are for usernames only', () => {
    for (const bad of [
      'hermi',
      'Hermi',
      'h3rmi',
      'hermi_team',
      'team_hermi',
      'hermi.official',
      'hermi2027',
      'hermi1',
      'hermiteam',
      'admin',
      'adm1n',
      'admin_jack',
      'support',
      'official',
      'columbia_official',
      'officialcolumbia',
      'columbia',
      'barnard',
      'barnard.official',
      'moderator',
      'appreview',
      'app_review',
    ])
      expect(reason(bad, 'username'), bad).toBe('reserved');
    // the same words are fine in a plan name
    for (const ok of ['Hermi Day', 'Columbia Library Day', 'Barnard Hall brunch', 'Admin lunch'])
      expect(reason(ok, 'planName')).toBe('ok');
  });

  test('reserved names do not catch ordinary usernames', () => {
    for (const ok of [
      'hermione',
      'adminah',
      'modern_dad',
      'supportive',
      'staffan',
      'maya_c',
      'jack.b',
    ])
      expect(reason(ok, 'username'), ok).toBe('ok');
  });

  test('a name that fails still fails with kind-specific profanity as a username', () => {
    expect(reason('n_a_z_1', 'username')).toBe('mild');
    expect(reason('fuck_you', 'username')).toBe('severe');
  });
});

describe('false positives', () => {
  test.each([
    // Columbia and Morningside Heights
    'Amsterdam Ave',
    'Butler Library',
    'Low Library Steps',
    'Broadway and 116th',
    'Morningside Park',
    'Hamilton Hall Dollar Dumplings',
    'Riverside Church',
    'Hungarian Pastry Shop',
    "Tom's Restaurant",
    'Prince Street Pizza',
    'Canal Street Market',
    "Hell's Kitchen",
    // Scunthorpe problems
    'Scunthorpe',
    'Sussex',
    'Essex',
    'Middlesex County',
    'Cumberland Farms',
    'Penistone',
    'Analysis Study Group',
    'Therapist visit',
    'Grape Soda Tasting',
    'Shiitake Ramen',
    "Assassin's Creed night",
    'Spicy Noodles',
    'Dyker Heights Lights',
    'Raccoon Rally',
    'Pakistan Tea House',
    'Ignazio Pizza',
    'Eskenazi Hall',
    'Nazia and Sam',
    'Sporn Brunch',
    'Poorna Thali',
    // ordinary words
    'class',
    'assignment',
    'assess',
    'cocktail bar',
    'Cocktails at 6',
    'Hancock',
    'Peacock Alley',
    'Cockburn',
    'Dickinson Reading',
    'Dickens Fair',
    'Titus',
    'Constance',
    'Classic Movie Night',
    'Magna Cum Laude Brunch',
    'Moby Dick Reading',
    "Dick's Sporting Goods",
    'Van Dyke Houses',
    'Museum of Sex',
    'Maine Coon Cat Cafe',
    'Wash It Away',
    'Habit Chain',
    'Banana Zipline',
    'Maryann Aziz',
    'Doña Zita',
    'Koenig Garden',
    'Ashok K Karmaker',
    'Pen Island',
    'Jerk Office',
    'Study Hall A',
    'Plan B',
    'Sat 5 pm',
    'Room 307 study',
    'Sunset @ 5',
    'Mac & Cheese 4 U',
    // first names
    'Matthew',
    'Cassidy',
    'Dickson',
    'Randy',
    'Willy',
    'Peter',
    'Isis',
    'Assad',
    'Cassandra',
    'Analise',
    'Hermione',
    'Mikey',
    'Kiki',
    'Raquel',
    'Seamus',
    'Fanny',
    'Jacob',
    'Jerome',
    'Shaquille',
    'Cummings',
  ])('%s passes', (text) => {
    expect(checkName(text, 'planName')).toEqual({ ok: true });
    // the same text as a username (letters, digits, _ and . only)
    const handle = text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 20);
    if (handle.length >= 3) expect(checkName(handle, 'username'), handle).toEqual({ ok: true });
  });
});

describe('display names', () => {
  test.each([
    // SEVERE terms, disguised the same ways as in a username
    ['f.u.c.k', 'severe'],
    ['Fuck Face', 'severe'],
    ['N1gger', 'severe'],
    ['pussyslayer', 'severe'],
    ['Big Bitch', 'severe'],
    ['Adolf Hitler', 'severe'],
    // passes for Hermi, staff or the schools: alone, or with nothing but role words
    ['Hermi', 'reserved'],
    ['HERMI', 'reserved'],
    ['Hermí', 'reserved'],
    ['h3rmi', 'reserved'],
    ['H e r m i', 'reserved'],
    ['Hermi Team', 'reserved'],
    ['Hermi Support', 'reserved'],
    ['Hermi Support Team', 'reserved'],
    ['Official Hermi', 'reserved'],
    ['Hermi_Official', 'reserved'],
    ['Hermi App', 'reserved'],
    ['Hermi HQ', 'reserved'],
    ['Hermi Safety Team', 'reserved'],
    ['hermiteam', 'reserved'],
    // filler words and a possessive do not get a reserved name past
    ['The Hermi Team', 'reserved'],
    ["Hermi's Team", 'reserved'],
    ['Hermi’s Team', 'reserved'],
    ['Official Hermi Account', 'reserved'],
    ['Hermi Team Member', 'reserved'],
    ['Team of Hermi', 'reserved'],
    ['The Admin', 'reserved'],
    ["Admin's Account", 'reserved'],
    ['Admin', 'reserved'],
    ['adm1n', 'reserved'],
    ['Administrator', 'reserved'],
    ['Moderator', 'reserved'],
    ['Staff', 'reserved'],
    ['Support', 'reserved'],
    ['Official', 'reserved'],
    ['App Review', 'reserved'],
    ['Apple Review', 'reserved'],
    // a school with a role word or another reserved word
    ['Columbia University', 'reserved'],
    ['Barnard Team', 'reserved'],
    ['Barnard Support', 'reserved'],
    ['Columbia Admin', 'reserved'],
    ['Columbia Official', 'reserved'],
    ['The Columbia University', 'reserved'],
  ] as const)('%s is refused as a display name (%s)', (text, why) => {
    expect(reason(text, 'displayName')).toBe(why);
  });

  test('only SEVERE counts: a MILD word is a name, a nickname or a surname', () => {
    for (const ok of ['Dick', 'Dick Van Dyke', 'Dick Hancock']) {
      expect(reason(ok, 'displayName'), ok).toBe('ok');
      // the same text still fails as a plan name
      expect(reason(ok, 'planName'), ok).toBe('mild');
    }
  });

  test('school words alone are a name or a place; as a username they stay reserved', () => {
    for (const ok of ['Barnard', 'Columbia', 'Barnard Columbia', 'The Barnard', 'Columbia Member'])
      expect(reason(ok, 'displayName'), ok).toBe('ok');
    for (const bad of ['barnard', 'columbia', 'barnard_columbia'])
      expect(reason(bad, 'username'), bad).toBe('reserved');
  });

  test('filler words alone, or with ordinary words, are not impersonation', () => {
    for (const ok of [
      'The Rock',
      'The Team',
      'Team Rocket',
      'Theo',
      'Theodora',
      'Thea',
      'Staffan',
      'Modi',
      'Hermia',
      'Ofelia',
      'Memberly Jones',
      'Account Manager Joe',
    ])
      expect(reason(ok, 'displayName'), ok).toBe('ok');
  });

  test('a reserved word inside a longer name, or beside a real name, is a person', () => {
    for (const ok of [
      'Hermione',
      'Hermione Granger',
      'Herminia',
      'Herminia Cruz',
      'Hermi Patel',
      'Adminah',
      'Adminah Bello',
      'Mod Patel',
      'Official Maya',
      'Columbia Reyes',
      'Barnard Smith',
    ])
      expect(reason(ok, 'displayName'), ok).toBe('ok');
  });

  // Real names that a naive profanity list refuses, from many places. A name that fails here is a bug in the filter.
  test.each([
    // English, Scottish, Irish and Welsh surnames and given names
    'Dick',
    'Richard Dick',
    'Dickson',
    'Dickinson',
    'Dickens',
    'Dickerson',
    'Cummings',
    'Cumming',
    'Cummins',
    'E. E. Cummings',
    'Cumberbatch',
    'Butts',
    'Weiner',
    'Anthony Weiner',
    'Hancock',
    'Matt Hancock',
    'Gaylord',
    'Gaylord Perry',
    'Hoare',
    'Tony Hoare',
    'Hore',
    'Horne',
    'Cockburn',
    'Cocker',
    'Babcock',
    'Hitchcock',
    'Woodcock',
    'Peacock',
    'Pocock',
    'Sexton',
    'Sexsmith',
    'Essex',
    'Sussex',
    'Middlesex',
    'Scunthorpe',
    'Penistone',
    'Lipschitz',
    'Titmuss',
    'Titus',
    'Twatt',
    'Raper',
    'Rapp',
    'Bangor',
    'Bonner',
    'Moore',
    'Fanny',
    'Randy',
    'Willy',
    'Seamus',
    'Fagan',
    'Fagin',
    'Fagg',
    'Spicer',
    'Pusey',
    'Beaver',
    'Hooker',
    'Cox',
    'Shakespeare',
    'Mountbatten',
    'Nigel',
    'Niger',
    'Nigel Farage',
    "Shaun O'Hare",
    // Vietnamese
    'Phuc',
    'Phúc',
    'Phuc Nguyen',
    'Nguyễn Văn Phúc',
    'Nguyen Thi Phuc',
    'Hoang Phuc Khang',
    'Dong',
    'Đông',
    'Kim Dong',
    'Dung',
    'Dung Tran',
    'Thuc',
    'Bich',
    'Tran Ny',
    'Trần Ny',
    'Nguyen Ny',
    'Vu Phuc',
    // Chinese, Cantonese, Korean, Japanese, Thai
    'Fuk',
    'Fuk Ming',
    'Wing Fuk Cheung',
    'Fook',
    'Fu Kwan',
    'Ng Fuk Hing',
    'Fu Ke',
    'Li Ya',
    'Wu Fu',
    'Ho Chi Minh',
    'Xu Dong',
    'Dong Hyun Kim',
    'Bang Ji Min',
    'Jung Hoo Lee',
    'Sung Min',
    'Fukuda',
    'Fukushima',
    'Fukui',
    'Hiroshi Fukuyama',
    'Lam Fuk Wing',
    'Ma Dong Seok',
    'Xi Jinping',
    'Hu Jintao',
    'Pornthip',
    'Pornchai Suwan',
    'Porntip',
    'Somchai',
    'Kunisada',
    'Kunio',
    // South Asian
    'Shitij',
    'Shitij Dikshit',
    'Rajesh Dikshit',
    'Dikshit',
    'Dixit',
    'Shital',
    'Sheetal',
    'Anusha',
    'Anushka',
    'Anusree',
    'Chutia',
    'Kunal',
    'Kunti',
    'Kumar',
    'Pooja',
    'Randhawa',
    'Bhosale',
    'Gandhi',
    'Sahasrabuddhe',
    'Nigam',
    'Titli',
    'Suchit',
    'Hari Om',
    // Arabic, Persian, Turkish, Hebrew, German
    'Nazir',
    'Nazim',
    'Nazia',
    'Nazli',
    'Naziha',
    'Assaf',
    'Assad',
    'Asad',
    'Hassan',
    'Yasser',
    'Mohammed',
    'Muhammad Ali',
    'Fatima',
    'Shitrit',
    'Kuntz',
    'Kunz',
    'Kuntze',
    'Fuchs',
    'Fuks',
    'Fick',
    'Ayşe',
    'Şahin',
    'İbrahim',
    'Gökçe',
    'Özge',
    'Dickstein',
    'Weinstein',
    'Horowitz',
    // African
    'Shittu',
    'Shitta',
    'Adebayo',
    'Olufemi',
    'Chukwuemeka',
    'Nneka',
    'Ngozi',
    'Okonkwo',
    'Dlamini',
    'Diallo',
    // European and Latin American
    'Aßmann',
    'Bußmann',
    'Strauß',
    'Concepción',
    'Concha',
    'Peña',
    'Núñez',
    'Muñoz',
    'Xiomara',
    'Ximena',
    'Ignazio',
    'Eskenazi',
    'Szymański',
    'Przybylski',
    'Ørjan',
    'Sørensen',
    "D'Angelo",
    "N'Dour",
    'Anne-Marie',
    'Jean-Luc Picard',
    'María José Hernández',
    'Zoë',
    // other scripts
    '周末',
    '李伟',
    '田中太郎',
    '김민준',
    'محمد علي',
    'Дмитрий Хохлов',
    'Ольга Иванова',
    'Σοφία',
    'नेहा शर्मा',
    'สมชาย',
    '🍜',
    // names that look like the reserved and filler words
    'Theo',
    'Theodora',
    'Thea',
    'Modi',
    'Hermia',
    'Ofelia',
    'Staffan',
    'The Rock',
    'Barnard',
    'Columbia',
    'Hermina',
    'Hermit',
    'Herman',
    'Hermes',
    'Modupe',
    'Moderna',
    'Staffa',
    'Columbus',
    'Barnaby',
  ])('%s passes as a display name', (text) => {
    expect(checkName(text, 'displayName'), text).toEqual({ ok: true });
  });
});

describe('Tran Ny', () => {
  // Allowed as a display name only, where a real name goes; as a handle or a plan name it reads as the slur
  test('is a display name, but not a username or a plan name', () => {
    for (const ok of ['Tran Ny', 'Trần Ny', 'Nguyen Tran Ny'])
      expect(reason(ok, 'displayName'), ok).toBe('ok');
    for (const bad of ['tran_ny', 'tran.ny', 'Tran Ny', 'tran ny'])
      expect(reason(bad, 'username'), bad).toBe('severe');
    for (const bad of ['Tran Ny night', 'Tran Ny'])
      expect(reason(bad, 'planName'), bad).toBe('severe');
  });

  test('the slur itself is still refused as a display name', () => {
    for (const bad of ['tranny', 'Tranny Night', 't r a n n y', 'tr4nny'])
      expect(reason(bad, 'displayName'), bad).toBe('severe');
  });
});

describe('safeDisplayName', () => {
  test('a good name is shown as it is', () => {
    expect(safeDisplayName({ name: 'Maya Chen', username: 'maya_c' })).toBe('Maya Chen');
    expect(safeDisplayName({ name: 'Dick Hancock', username: 'dh' })).toBe('Dick Hancock');
  });

  test('a name that fails falls back to @username, then to the caller text, then to a default', () => {
    expect(safeDisplayName({ name: 'Fuck Face', username: 'maya_c' })).toBe('@maya_c');
    expect(safeDisplayName({ name: 'Hermi Team', username: 'maya_c' })).toBe('@maya_c');
    expect(safeDisplayName({ name: 'Fuck Face', username: 'n_a_z_1' })).toBe('A Hermi user');
    expect(safeDisplayName({ name: 'Fuck Face', username: 'n_a_z_1' }, { none: 'Someone' })).toBe(
      'Someone',
    );
    // a username that passes for staff is not shown either
    expect(safeDisplayName({ name: 'Fuck Face', username: 'hermi_team' }, { none: 'x' })).toBe('x');
  });

  test('a missing or blank name, or no user at all, is the same fallback', () => {
    expect(safeDisplayName({ username: 'maya_c' })).toBe('@maya_c');
    expect(safeDisplayName({ name: null, username: 'maya_c' })).toBe('@maya_c');
    expect(safeDisplayName({ name: '   ', username: 'maya_c' })).toBe('@maya_c');
    expect(safeDisplayName({ name: '', username: null })).toBe('A Hermi user');
    expect(safeDisplayName(null)).toBe('A Hermi user');
    expect(safeDisplayName(undefined, { none: 'Someone' })).toBe('Someone');
  });

  test('first: the first word of the name, which is checked on its own', () => {
    expect(safeDisplayName({ name: 'Maya Chen', username: 'maya_c' }, { first: true })).toBe(
      'Maya',
    );
    expect(safeDisplayName({ name: '  Maya  Chen ' }, { first: true })).toBe('Maya');
    // "Hermi Patel" is a name, but "Hermi" alone is not
    expect(safeDisplayName({ name: 'Hermi Patel', username: 'hp' }, { first: true })).toBe('@hp');
    expect(safeDisplayName({ name: 'Hermi Patel', username: 'hp' })).toBe('Hermi Patel');
  });

  test('handleFirst: @username when it passes, else the name', () => {
    expect(safeDisplayName({ name: 'Ava', username: 'ava' }, { handleFirst: true })).toBe('@ava');
    expect(safeDisplayName({ name: 'Ava', username: 'n_a_z_1' }, { handleFirst: true })).toBe(
      'Ava',
    );
    expect(safeDisplayName({ name: 'Fuck', username: null }, { handleFirst: true })).toBe(
      'A Hermi user',
    );
  });
});

describe('assertNameAllowed', () => {
  test('throws 400 NAME_NOT_ALLOWED with a message that does not say what matched', () => {
    for (const [text, kind, message] of [
      ['n_a_z_1', 'username', 'Choose a different username'],
      ['hermi_team', 'username', 'Choose a different username'],
      ['fuck night', 'planName', 'Choose a different name for this plan'],
    ] as const) {
      const err = (() => {
        try {
          assertNameAllowed(text, kind);
        } catch (e) {
          return e as ApiError;
        }
      })();
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 400, code: 'NAME_NOT_ALLOWED', message });
    }
    expect(() => assertNameAllowed('Amsterdam Ave', 'planName')).not.toThrow();
  });
});

describe('Gemini plan names', () => {
  const gemini = (reply: string | Error) => {
    const llm = new GeminiLlm('k', 'fixture-model');
    llm.json = (async () => {
      if (reply instanceof Error) throw reply;
      return { name: reply };
    }) as typeof llm.json;
    return llm;
  };

  test('a good name passes through, cut to six words', async () => {
    expect(await gemini('Library then a long slow walk home').planName(['Butler', 'Lawn'])).toBe(
      'Library then a long slow walk',
    );
  });

  test('a name that fails the filter is replaced by the deterministic fallback', async () => {
    expect(await gemini('Fuck it Friday').planName(['Diner', 'Lawn'])).toBe('Diner and more');
    expect(await gemini('n.i.g.g.a night').planName(['Diner'])).toBe('Diner');
  });

  test('an error still falls back', async () => {
    expect(await gemini(new Error('boom')).planName(['Diner', 'Lawn'])).toBe('Diner and more');
  });
});
