import { describe, it, expect } from 'vitest';
import { sniffImageType, matchesDeclaredImageType } from './uploads';

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
const bytes = (a: number[]) => new Uint8Array(a);
const text = (s: string) => new TextEncoder().encode(s);

describe('sniffImageType', () => {
  it('recognises JPEG, PNG and WebP', () => {
    expect(sniffImageType(bytes(JPEG))).toBe('image/jpeg');
    expect(sniffImageType(bytes(PNG))).toBe('image/png');
    expect(sniffImageType(bytes(WEBP))).toBe('image/webp');
  });

  it('rejects SVG, HTML, PDF, GIF and empty or truncated input', () => {
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(text('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffImageType(text('<html><script>1</script></html>'))).toBeNull();
    expect(sniffImageType(text('%PDF-1.7'))).toBeNull();
    expect(sniffImageType(text('GIF89a'))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(bytes([0xff, 0xd8]))).toBeNull();
  });

  it('rejects a RIFF container that is not WebP', () => {
    const wave = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45];
    expect(sniffImageType(bytes(wave))).toBeNull();
  });
});

describe('matchesDeclaredImageType', () => {
  it('requires the content to be the declared type', () => {
    expect(matchesDeclaredImageType(bytes(PNG), 'image/png')).toBe(true);
    expect(matchesDeclaredImageType(bytes(PNG), 'image/jpeg')).toBe(false);
    expect(matchesDeclaredImageType(text('<svg/>'), 'image/png')).toBe(false);
  });
});
