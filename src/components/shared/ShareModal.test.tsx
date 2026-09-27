import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ShareModal from './ShareModal';

// Mock framer-motion to avoid portal/animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { variants, initial, animate, exit, transition, ...rest } = props;
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

const mockCampaign = {
  title: 'Bantu Korban Bencana Alam',
  slug: 'bantu-korban-bencana-alam',
  coverImage: '/images/campaign-1.jpg',
  description: 'Bencana alam telah melanda daerah X dan membutuhkan bantuan segera untuk para korban yang kehilangan tempat tinggal.',
};

describe('ShareModal', () => {
  let mockOpen: ReturnType<typeof vi.fn>;
  const onClose = vi.fn();

  beforeEach(() => {
    mockOpen = vi.fn();
    Object.defineProperty(window, 'open', { value: mockOpen, writable: true });
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://fundforindonesia.org' },
      writable: true,
    });
    onClose.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders modal with share title when open', () => {
    render(<ShareModal isOpen={true} onClose={onClose} campaign={mockCampaign} />);
    expect(screen.getByText('Bagikan Campaign')).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(<ShareModal isOpen={false} onClose={onClose} campaign={mockCampaign} />);
    expect(screen.queryByText('Bagikan Campaign')).not.toBeInTheDocument();
  });

  it('renders all 4 share options', () => {
    render(<ShareModal isOpen={true} onClose={onClose} campaign={mockCampaign} />);
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
    expect(screen.getByText('Twitter/X')).toBeInTheDocument();
    expect(screen.getByText('Salin Link')).toBeInTheDocument();
  });

  it('opens WhatsApp share link in new tab, tagged with its own Traffic Source (ticket 24)', () => {
    render(<ShareModal isOpen={true} onClose={onClose} campaign={mockCampaign} />);
    const whatsappBtn = screen.getByLabelText('Bagikan via WhatsApp');
    fireEvent.click(whatsappBtn);

    const expectedUrl = `https://fundforindonesia.org/campaign/${mockCampaign.slug}?src=whatsapp`;
    const expectedText = `Bantu donasi untuk: ${mockCampaign.title} - ${mockCampaign.description.slice(0, 100)}`;
    expect(mockOpen).toHaveBeenCalledWith(
      `https://wa.me/?text=${encodeURIComponent(expectedText + ' ' + expectedUrl)}`,
      '_blank'
    );
  });

  it('opens Facebook share link in new tab, tagged with its own Traffic Source (ticket 24)', () => {
    render(<ShareModal isOpen={true} onClose={onClose} campaign={mockCampaign} />);
    const facebookBtn = screen.getByLabelText('Bagikan via Facebook');
    fireEvent.click(facebookBtn);

    const expectedUrl = `https://fundforindonesia.org/campaign/${mockCampaign.slug}?src=facebook`;
    expect(mockOpen).toHaveBeenCalledWith(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(expectedUrl)}`,
      '_blank'
    );
  });

  it('opens Twitter share link in new tab, tagged with its own Traffic Source (ticket 24)', () => {
    render(<ShareModal isOpen={true} onClose={onClose} campaign={mockCampaign} />);
    const twitterBtn = screen.getByLabelText('Bagikan via Twitter/X');
    fireEvent.click(twitterBtn);

    const expectedUrl = `https://fundforindonesia.org/campaign/${mockCampaign.slug}?src=twitter`;
    const expectedText = `Bantu donasi untuk: ${mockCampaign.title} - ${mockCampaign.description.slice(0, 100)}`;
    expect(mockOpen).toHaveBeenCalledWith(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(expectedText)}&url=${encodeURIComponent(expectedUrl)}`,
      '_blank'
    );
  });

  it('copies a campaign URL tagged with its own Traffic Source (ticket 24) and shows confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ShareModal isOpen={true} onClose={onClose} campaign={mockCampaign} />);
    const copyBtn = screen.getByLabelText('Bagikan via Salin Link');
    fireEvent.click(copyBtn);

    const expectedUrl = `https://fundforindonesia.org/campaign/${mockCampaign.slug}?src=copy`;
    expect(writeText).toHaveBeenCalledWith(expectedUrl);

    await waitFor(() => {
      expect(screen.getByText('Tersalin!')).toBeInTheDocument();
    });
  });

  it('truncates description to 100 characters in share text', () => {
    const longDescription = 'A'.repeat(200);
    const campaign = { ...mockCampaign, description: longDescription };
    render(<ShareModal isOpen={true} onClose={onClose} campaign={campaign} />);

    const whatsappBtn = screen.getByLabelText('Bagikan via WhatsApp');
    fireEvent.click(whatsappBtn);

    const callArg = mockOpen.mock.calls[0][0] as string;
    const decodedText = decodeURIComponent(callArg.replace('https://wa.me/?text=', ''));
    const expectedShareText = `Bantu donasi untuk: ${campaign.title} - ${'A'.repeat(100)}`;
    expect(decodedText).toContain(expectedShareText);
  });

  it('generates campaign URL using slug', () => {
    render(<ShareModal isOpen={true} onClose={onClose} campaign={mockCampaign} />);
    const facebookBtn = screen.getByLabelText('Bagikan via Facebook');
    fireEvent.click(facebookBtn);

    const callArg = mockOpen.mock.calls[0][0] as string;
    expect(callArg).toContain(encodeURIComponent(`https://fundforindonesia.org/campaign/${mockCampaign.slug}`));
  });
});
