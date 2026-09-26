// @vitest-environment node
// A server route test: jsdom replaces the global FormData/File/Blob, and
// Node 24's built-in undici no longer serialises a jsdom File as multipart,
// so request.formData() failed with an undici AssertionError (500s).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  validateFileType,
  validateFileSize,
  generateUniqueFilename,
  MAX_FILE_SIZE,
  ALLOWED_TYPES,
} from './route';

// Mock fs/promises
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    default: { ...actual, mkdir: (...args: unknown[]) => mockMkdir(...args), writeFile: (...args: unknown[]) => mockWriteFile(...args) },
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  };
});

// POST needs a signed-in user and nothing more. These tests exercise the
// upload logic, not the gate, so a signed-in user holding no assignment is
// mocked for the whole file; the gate itself is asserted separately at the
// bottom.
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(async () => mockSession),
}));

let mockSession: { user: { id: string; assignments: string[] } } | null = {
  user: { id: 'u1', assignments: [] },
};

import { POST } from './route';

function createUploadRequest(file: File | null): NextRequest {
  const formData = new FormData();
  if (file) {
    formData.append('file', file);
  }

  return new NextRequest('http://localhost:3000/api/upload', {
    method: 'POST',
    body: formData,
  });
}

function createMockFile(
  name: string,
  size: number,
  type: string
): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

describe('Upload validation utilities', () => {
  describe('validateFileType', () => {
    it('accepts image/jpeg', () => {
      expect(validateFileType('image/jpeg')).toBe(true);
    });

    it('accepts image/png', () => {
      expect(validateFileType('image/png')).toBe(true);
    });

    it('accepts image/webp', () => {
      expect(validateFileType('image/webp')).toBe(true);
    });

    it('rejects application/pdf', () => {
      expect(validateFileType('application/pdf')).toBe(false);
    });

    it('rejects text/plain', () => {
      expect(validateFileType('text/plain')).toBe(false);
    });

    it('rejects image/gif', () => {
      expect(validateFileType('image/gif')).toBe(false);
    });
  });

  describe('validateFileSize', () => {
    it('accepts file at exactly 5MB', () => {
      expect(validateFileSize(MAX_FILE_SIZE)).toBe(true);
    });

    it('accepts file under 5MB', () => {
      expect(validateFileSize(1024)).toBe(true);
    });

    it('rejects file over 5MB', () => {
      expect(validateFileSize(MAX_FILE_SIZE + 1)).toBe(false);
    });

    it('accepts zero size', () => {
      expect(validateFileSize(0)).toBe(true);
    });
  });

  describe('generateUniqueFilename', () => {
    it('takes the extension from the mime type, never the filename', () => {
      // The old behaviour preferred the uploader's own extension, so an
      // image/png named "evil.html" was written as .html into public/uploads
      // and served from the same origin as the donation flow. The filename is
      // attacker-controlled and is now ignored outright.
      expect(generateUniqueFilename('image/jpeg', 'photo.jpg')).toMatch(/\.jpg$/);
      expect(generateUniqueFilename('image/png', 'evil.html')).toMatch(/\.png$/);
      expect(generateUniqueFilename('image/png', 'x.svg')).toMatch(/\.png$/);
      expect(generateUniqueFilename('image/jpeg', 'a.PhP')).toMatch(/\.jpg$/);
    });

    it('uses the mime type when no filename is given at all', () => {
      expect(generateUniqueFilename('image/png')).toMatch(/\.png$/);
      expect(generateUniqueFilename('image/png', 'noext')).toMatch(/\.png$/);
    });

    it('generates unique filenames on consecutive calls', () => {
      const f1 = generateUniqueFilename('image/jpeg', 'a.jpg');
      const f2 = generateUniqueFilename('image/jpeg', 'a.jpg');
      expect(f1).not.toBe(f2);
    });

    it('handles webp mime type', () => {
      const filename = generateUniqueFilename('image/webp', 'cover.webp');
      expect(filename).toMatch(/\.webp$/);
    });
  });
});

describe('POST /api/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('returns 400 if no file is provided', async () => {
    const formData = new FormData();
    const request = new NextRequest('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe('File harus diunggah');
  });

  it('returns 400 for unsupported file type', async () => {
    const file = createMockFile('document.pdf', 1024, 'application/pdf');
    const request = createUploadRequest(file);

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe('Tipe file tidak didukung. Gunakan JPEG, PNG, atau WebP.');
  });

  it('returns 400 for text/plain file type', async () => {
    const file = createMockFile('readme.txt', 512, 'text/plain');
    const request = createUploadRequest(file);

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain('Tipe file tidak didukung');
  });

  it('uploads a valid JPEG file and returns 201 with URL', async () => {
    const file = createMockFile('photo.jpg', 1024, 'image/jpeg');
    const request = createUploadRequest(file);

    const response = await POST(request);
    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.url).toMatch(/^\/uploads\/.+\.jpg$/);
    expect(data.filename).toMatch(/\.jpg$/);
  });

  it('uploads a valid PNG file and returns 201 with URL', async () => {
    const file = createMockFile('image.png', 2048, 'image/png');
    const request = createUploadRequest(file);

    const response = await POST(request);
    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.url).toMatch(/^\/uploads\/.+\.png$/);
    expect(data.filename).toMatch(/\.png$/);
  });

  it('uploads a valid WebP file and returns 201 with URL', async () => {
    const file = createMockFile('cover.webp', 512, 'image/webp');
    const request = createUploadRequest(file);

    const response = await POST(request);
    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.url).toMatch(/^\/uploads\/.+\.webp$/);
    expect(data.filename).toMatch(/\.webp$/);
  });

  it('accepts a file exactly at 5MB', async () => {
    const file = createMockFile('exact.jpg', 5 * 1024 * 1024, 'image/jpeg');
    const request = createUploadRequest(file);

    const response = await POST(request);
    expect(response.status).toBe(201);
  });

  it('generates unique filenames for each upload', async () => {
    const file1 = createMockFile('photo.jpg', 1024, 'image/jpeg');
    const file2 = createMockFile('photo.jpg', 1024, 'image/jpeg');

    const request1 = createUploadRequest(file1);
    const request2 = createUploadRequest(file2);

    const response1 = await POST(request1);
    const response2 = await POST(request2);

    const data1 = await response1.json();
    const data2 = await response2.json();

    expect(data1.filename).not.toBe(data2.filename);
  });

  it('calls mkdir to ensure upload directory exists', async () => {
    const file = createMockFile('photo.jpg', 1024, 'image/jpeg');
    const request = createUploadRequest(file);

    await POST(request);

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('uploads'),
      { recursive: true }
    );
  });

  it('calls writeFile with file content', async () => {
    const file = createMockFile('photo.jpg', 1024, 'image/jpeg');
    const request = createUploadRequest(file);

    await POST(request);

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('uploads'),
      expect.any(Buffer)
    );
  });

  it('returns 500 on filesystem error', async () => {
    mockMkdir.mockRejectedValueOnce(new Error('Disk full'));

    const file = createMockFile('photo.jpg', 1024, 'image/jpeg');
    const request = createUploadRequest(file);

    const response = await POST(request);
    expect(response.status).toBe(500);

    const data = await response.json();
    expect(data.error).toBe('Gagal mengunggah file');
  });

  describe('authentication gate', () => {
    it('rejects an unauthenticated upload with 401', async () => {
      const previous = mockSession;
      mockSession = null;
      try {
        const file = new File(['x'], 'a.png', { type: 'image/png' });
        const res = await POST(createUploadRequest(file));
        // The endpoint shipped with no auth at all and wrote into a
        // publicly-served directory on the donation domain.
        expect(res.status).toBe(401);
        expect(mockWriteFile).not.toHaveBeenCalled();
      } finally {
        mockSession = previous;
      }
    });
  });
});