import { describe, it, expect } from 'vitest';
import { coverImageSchema, isValidCoverImage } from './cover-image';

describe('coverImageSchema', () => {
  it.each(['/uploads/lq2k9-abc123.png', '/uploads/a.b_c-d.webp', 'https://example.com/cover.jpg'])(
    'accepts %s',
    (value) => {
      expect(coverImageSchema.safeParse(value).success).toBe(true);
      expect(isValidCoverImage(value)).toBe(true);
    },
  );

  it.each([
    '/uploads/../etc/passwd',
    '/uploads/..',
    '/uploads/a/b.png',
    '/uploads/',
    '/uploads/%2e%2e%2fx.png',
    '//evil.example/uploads/x.png',
    '/other/x.png',
    'uploads/x.png',
  ])('rejects the unsafe local path %s', (value) => {
    expect(coverImageSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    'http://example.com/x.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'ftp://example.com/x.png',
    'not-a-url',
    '',
  ])('rejects the scheme or shape %s', (value) => {
    const result = coverImageSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe('URL gambar tidak valid');
  });
});
