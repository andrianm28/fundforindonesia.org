import { describe, it, expect, vi } from 'vitest';
import { categoryExists, checkSlug, parseCategoryChange, parseNewCategory } from './categories';

describe('checkSlug', () => {
  it.each(['masjid', 'rumah-ibadah', 'wakaf-2', 'a1'])('accepts %s', (slug) => {
    expect(checkSlug(slug).ok).toBe(true);
  });

  it.each(['', 'Masjid', 'rumah ibadah', 'rumah_ibadah', '-masjid', 'masjid-', 'a--b', 'ibadah!', 123, null])(
    'refuses %j',
    (slug) => {
      expect(checkSlug(slug).ok).toBe(false);
    }
  );
});

describe('parseNewCategory', () => {
  const valid = { name: ' Masjid ', slug: 'masjid', icon: '🕌' };

  it('trims the name and defaults the order to 0', () => {
    expect(parseNewCategory(valid)).toEqual({
      ok: true,
      value: { name: 'Masjid', slug: 'masjid', icon: '🕌', order: 0 },
    });
  });

  it('refuses what is missing or malformed, in Indonesian', () => {
    expect(parseNewCategory({ ...valid, name: '  ' })).toMatchObject({ ok: false, error: 'Nama kategori harus diisi.' });
    expect(parseNewCategory({ ...valid, slug: 'Bad Slug' })).toMatchObject({ ok: false });
    expect(parseNewCategory({ ...valid, icon: '' })).toMatchObject({ ok: false, error: 'Ikon kategori harus diisi.' });
    expect(parseNewCategory({ ...valid, order: -1 })).toMatchObject({ ok: false });
    expect(parseNewCategory({ ...valid, order: 1.5 })).toMatchObject({ ok: false });
    expect(parseNewCategory([1])).toMatchObject({ ok: false });
    expect(parseNewCategory(undefined)).toMatchObject({ ok: false });
  });
});

describe('parseCategoryChange', () => {
  it('takes name, icon and order', () => {
    expect(parseCategoryChange({ name: ' Baru ', order: 3 })).toEqual({ ok: true, value: { name: 'Baru', order: 3 } });
  });

  it('refuses a slug change, an empty change and a blank name', () => {
    expect(parseCategoryChange({ slug: 'lain' })).toMatchObject({ ok: false });
    expect(parseCategoryChange({})).toMatchObject({ ok: false, error: 'Tidak ada perubahan yang dikirim.' });
    expect(parseCategoryChange({ name: '' })).toMatchObject({ ok: false });
  });
});

describe('categoryExists', () => {
  it('looks the slug up in the Category table', async () => {
    const findUnique = vi.fn().mockResolvedValueOnce({ id: '1', slug: 'masjid' }).mockResolvedValueOnce(null);
    const db = { category: { findUnique } };

    expect(await categoryExists(db, 'masjid')).toBe(true);
    expect(await categoryExists(db, 'lainnya')).toBe(false);
    expect(findUnique).toHaveBeenCalledWith({ where: { slug: 'lainnya' } });
  });
});
