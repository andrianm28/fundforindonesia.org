import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { CampaignUpdateForm } from './CampaignUpdateForm';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function res(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

describe('CampaignUpdateForm', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(cleanup);

  function fill(title: string, content: string) {
    fireEvent.change(screen.getByLabelText('Judul'), { target: { value: title } });
    fireEvent.change(screen.getByLabelText('Isi kabar'), { target: { value: content } });
  }

  it('refuses an empty title or body without calling the server', async () => {
    render(<CampaignUpdateForm slug="s" />);
    fireEvent.click(screen.getByRole('button', { name: 'Terbitkan kabar' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('posts title and content to the Campaign updates route and confirms', async () => {
    mockFetch.mockReturnValue(res(201, { id: 'u1' }));
    const onPosted = vi.fn();
    render(<CampaignUpdateForm slug="my-slug" onPosted={onPosted} />);
    fill('Dana tersalur', 'Sudah sampai.');
    fireEvent.click(screen.getByRole('button', { name: 'Terbitkan kabar' }));
    await screen.findByText('Kabar terbit.');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/campaigns/my-slug/updates');
    expect(JSON.parse(init.body)).toEqual({ title: 'Dana tersalur', content: 'Sudah sampai.', images: [] });
    expect(onPosted).toHaveBeenCalled();
    expect((screen.getByLabelText('Judul') as HTMLInputElement).value).toBe('');
  });

  it('uploads a chosen image first and sends its URL', async () => {
    mockFetch
      .mockReturnValueOnce(res(201, { url: '/uploads/x.jpg' }))
      .mockReturnValueOnce(res(201, { id: 'u1' }));
    render(<CampaignUpdateForm slug="s" />);
    fill('T', 'C');
    const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Gambar (opsional)'), { target: { files: [file] } });
    await screen.findByText('x.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Terbitkan kabar' }));
    await screen.findByText('Kabar terbit.');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/upload');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).images).toEqual(['/uploads/x.jpg']);
  });

  it('shows the server refusal', async () => {
    mockFetch.mockReturnValue(
      res(403, { error: 'Hanya Fundraiser Campaign ini yang dapat melakukan tindakan ini.', code: 'NOT_AUTHORIZED' }),
    );
    render(<CampaignUpdateForm slug="s" />);
    fill('T', 'C');
    fireEvent.click(screen.getByRole('button', { name: 'Terbitkan kabar' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Hanya Fundraiser'));
  });
});
