import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_SETTINGS,
  dialTarget,
  InvalidSiteSettingError,
  resolveSiteSettings,
  resolveSiteSettingsOrDefaults,
  setSiteSetting,
  socialHandle,
} from './site-settings';

type Row = { key: string; value: unknown };

function makeDb(rows: Row[] = []) {
  const upserts: unknown[] = [];
  const db = {
    siteSetting: {
      findMany: async () => rows,
      upsert: async (args: unknown) => {
        upserts.push(args);
      },
    },
  };
  return { db, upserts };
}

describe('resolveSiteSettings', () => {
  it('shows the text the pages carried before they were editable until an Admin changes it', async () => {
    const { db } = makeDb();
    expect(await resolveSiteSettings(db as never)).toEqual(DEFAULT_SITE_SETTINGS);
  });

  it('shows a stored section and leaves the others on their defaults', async () => {
    const stored = { ...DEFAULT_SITE_SETTINGS.footer, about: 'Teks baru.' };
    const { db } = makeDb([{ key: 'footer', value: stored }]);
    const settings = await resolveSiteSettings(db as never);
    expect(settings.footer.about).toBe('Teks baru.');
    expect(settings.contact).toEqual(DEFAULT_SITE_SETTINGS.contact);
  });

  it('falls back to the default for a stored row that no longer parses, and ignores unknown keys', async () => {
    const { db } = makeDb([
      { key: 'contact', value: { email: 'bukan-email' } },
      { key: 'tidak-dikenal', value: 1 },
    ]);
    expect(await resolveSiteSettings(db as never)).toEqual(DEFAULT_SITE_SETTINGS);
  });

  it('shows the defaults when the database cannot be read', async () => {
    const db = { siteSetting: { findMany: async () => { throw new Error('down'); } } };
    expect(await resolveSiteSettingsOrDefaults(db as never)).toEqual(DEFAULT_SITE_SETTINGS);
  });
});

describe('setSiteSetting', () => {
  it('stores a valid section as the acting Admin', async () => {
    const { db, upserts } = makeDb();
    const value = { ...DEFAULT_SITE_SETTINGS.social, instagram: '' };
    await setSiteSetting(db as never, { key: 'social', value, actorId: 'admin-1' });
    expect(upserts).toEqual([
      {
        where: { key: 'social' },
        create: { key: 'social', value, updatedById: 'admin-1' },
        update: { value, updatedById: 'admin-1' },
      },
    ]);
  });

  it('refuses an unknown section', async () => {
    const { db } = makeDb();
    await expect(setSiteSetting(db as never, { key: 'payment', value: {}, actorId: 'a' })).rejects.toBeInstanceOf(
      InvalidSiteSettingError,
    );
  });

  it.each([
    ['a javascript: hero link', 'hero', { slides: [{ ...DEFAULT_SITE_SETTINGS.hero.slides[0], ctaHref: 'javascript:alert(1)' }] }],
    ['a protocol-relative hero image', 'hero', { slides: [{ ...DEFAULT_SITE_SETTINGS.hero.slides[0], image: '//evil.example/x.jpg' }] }],
    ['no hero slide at all', 'hero', { slides: [] }],
    ['an http social link', 'social', { ...DEFAULT_SITE_SETTINGS.social, facebook: 'http://facebook.com/x' }],
    ['a malformed support email', 'contact', { ...DEFAULT_SITE_SETTINGS.contact, email: 'x' }],
    ['an empty footer text', 'footer', { about: '  ' }],
    ['no About paragraph', 'pages', { ...DEFAULT_SITE_SETTINGS.pages, aboutParagraphs: [] }],
  ])('refuses %s and writes nothing', async (_name, key, value) => {
    const { db, upserts } = makeDb();
    await expect(setSiteSetting(db as never, { key, value, actorId: 'a' })).rejects.toBeInstanceOf(InvalidSiteSettingError);
    expect(upserts).toEqual([]);
  });

  it('lets an Admin hide a phone number and a social link by emptying them', async () => {
    const { db, upserts } = makeDb();
    await setSiteSetting(db as never, { key: 'contact', value: { ...DEFAULT_SITE_SETTINGS.contact, phone: '' }, actorId: 'a' });
    await setSiteSetting(db as never, { key: 'social', value: { ...DEFAULT_SITE_SETTINGS.social, twitter: '' }, actorId: 'a' });
    expect(upserts).toHaveLength(2);
  });
});

describe('helpers', () => {
  it('turns a displayed number into a dialling target', () => {
    expect(dialTarget('(021) 1234-5678')).toBe('62211234' + '5678');
    expect(dialTarget('+62 21 1234-5678')).toBe('622112345678');
    expect(dialTarget('0812-3456-7890')).toBe('6281234567890');
  });

  it('reads a handle from a profile URL', () => {
    expect(socialHandle('https://instagram.com/fundforindonesia')).toBe('@fundforindonesia');
    expect(socialHandle('https://example.org')).toBe('example.org');
  });
});
