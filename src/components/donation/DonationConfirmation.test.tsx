import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DonationConfirmation } from './DonationConfirmation';
import { Campaign } from '@/types/campaign';
import { PaymentMethod } from '@/types/donation';

afterEach(() => {
  cleanup();
});

const mockCampaign: Campaign = {
  id: 'campaign-1',
  slug: 'bantu-korban-banjir',
  title: 'Bantu Korban Banjir Jakarta',
  description: 'Membantu korban banjir',
  story: 'Cerita lengkap',
  coverImage: '/images/campaign.jpg',
  targetAmount: 100000000,
  collectedAmount: 50000000,
  category: 'bencana-alam',
  lifecycleStatus: 'ACTIVE',
  isUrgent: true,
  isDemo: false,
  deadline: null,
  creatorId: 'user-1',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockPaymentMethod: PaymentMethod = {
  id: 'bca',
  name: 'BCA Virtual Account',
  type: 'bank_transfer',
  icon: '/icons/bca.png',
  fee: 2500,
};

const defaultProps = {
  campaign: mockCampaign,
  amount: 50000,
  paymentMethod: mockPaymentMethod,
  prayer: '',
  isAnonymous: false,
  onPrayerChange: vi.fn(),
  onAnonymousToggle: vi.fn(),
  onConfirm: vi.fn(),
  isSubmitting: false,
};

describe('DonationConfirmation', () => {
  it('renders campaign title in summary', () => {
    render(<DonationConfirmation {...defaultProps} />);
    expect(screen.getByText('Bantu Korban Banjir Jakarta')).toBeInTheDocument();
  });

  it('displays formatted donation amount', () => {
    render(<DonationConfirmation {...defaultProps} />);
    expect(screen.getByText('Rp50.000')).toBeInTheDocument();
  });

  it('displays payment method name', () => {
    render(<DonationConfirmation {...defaultProps} />);
    expect(screen.getByText('BCA Virtual Account')).toBeInTheDocument();
  });

  // Gross (CONTEXT.md): "Nominal yang dibayar Donor untuk satu Payment...
  // sama dengan nominal Donation, karena tidak ada tambahan apa pun di
  // atasnya." A per-method "Biaya Layanan" added to a "Total" told the donor
  // they would pay amount + fee, which is exactly the addition Gross rules
  // out -- it never reflected what the API actually charged (spot-check:
  // src/app/campaign/[slug]/donate/page.tsx's own paymentMethods always set
  // fee: 0, with a comment explaining why). The donor is never shown a
  // second, larger number to pay.
  it('never shows a total larger than the donation amount, whatever paymentMethod.fee says', () => {
    render(<DonationConfirmation {...defaultProps} />);
    expect(screen.queryByText('Rp52.500')).toBeNull();
    expect(screen.queryByText(/Biaya Layanan/)).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
  });

  // Provider Fee (CONTEXT.md): "dibaca dari payload penyedia dan ditanggung
  // Campaign" -- real, but never known until Settlement, and never the
  // Donor's to pay (Gross, above). Shown as a disclosure, not a number this
  // screen would have to invent (prd-compliance 18, ADR 0007: the platform
  // absorbs it on refund, so the Donor is never short either way).
  it('discloses the Provider Fee as the Campaign’s cost, not the donor’s, before payment', () => {
    render(<DonationConfirmation {...defaultProps} />);
    expect(screen.getByText(/Biaya Provider/)).toBeInTheDocument();
    expect(
      screen.getByText(/ditanggung campaign.*tidak menambah nominal yang anda bayar/i),
    ).toBeInTheDocument();
  });

  it('renders anonymous toggle checkbox', () => {
    render(<DonationConfirmation {...defaultProps} />);
    expect(screen.getByText('Sembunyikan nama saya (donasi anonim)')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
  });

  it('checkbox reflects isAnonymous prop', () => {
    render(<DonationConfirmation {...defaultProps} isAnonymous={true} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('calls onAnonymousToggle when checkbox changes', () => {
    const onAnonymousToggle = vi.fn();
    render(<DonationConfirmation {...defaultProps} onAnonymousToggle={onAnonymousToggle} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onAnonymousToggle).toHaveBeenCalledWith(true);
  });

  it('renders prayer textarea with placeholder', () => {
    render(<DonationConfirmation {...defaultProps} />);
    expect(screen.getByPlaceholderText('Tulis doa atau harapanmu...')).toBeInTheDocument();
  });

  it('displays prayer text from prop', () => {
    render(<DonationConfirmation {...defaultProps} prayer="Semoga lancar" />);
    const textarea = screen.getByPlaceholderText('Tulis doa atau harapanmu...') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Semoga lancar');
  });

  it('calls onPrayerChange when typing in textarea', () => {
    const onPrayerChange = vi.fn();
    render(<DonationConfirmation {...defaultProps} onPrayerChange={onPrayerChange} />);
    const textarea = screen.getByPlaceholderText('Tulis doa atau harapanmu...');
    fireEvent.change(textarea, { target: { value: 'Doa saya' } });
    expect(onPrayerChange).toHaveBeenCalledWith('Doa saya');
  });

  it('shows character counter', () => {
    render(<DonationConfirmation {...defaultProps} prayer="Hello" />);
    expect(screen.getByText('5/500')).toBeInTheDocument();
  });

  it('shows 0/500 when prayer is empty', () => {
    render(<DonationConfirmation {...defaultProps} prayer="" />);
    expect(screen.getByText('0/500')).toBeInTheDocument();
  });

  it('does not call onPrayerChange when text exceeds 500 characters', () => {
    const onPrayerChange = vi.fn();
    const longText = 'a'.repeat(501);
    render(<DonationConfirmation {...defaultProps} onPrayerChange={onPrayerChange} />);
    const textarea = screen.getByPlaceholderText('Tulis doa atau harapanmu...');
    fireEvent.change(textarea, { target: { value: longText } });
    expect(onPrayerChange).not.toHaveBeenCalled();
  });

  it('renders Donasi Sekarang button', () => {
    render(<DonationConfirmation {...defaultProps} />);
    expect(screen.getByRole('button', { name: /donasi sekarang/i })).toBeInTheDocument();
  });

  it('calls onConfirm when button is clicked', () => {
    const onConfirm = vi.fn();
    render(<DonationConfirmation {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /donasi sekarang/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // Explicit ikrar confirmation (CONTEXT.md, Akad Wakaf; PRD user story 17:
  // "confirm the ikrar by checkbox ... so that the pledge is explicit rather
  // than assumed"), shown only on a `wakaf` Campaign.
  describe('ikrar wakaf confirmation', () => {
    const ikrarWakaf = {
      confirmed: false,
      onToggle: vi.fn(),
      nazhirName: 'Yayasan Contoh',
      purpose: 'Bantu Korban Banjir Jakarta',
      error: undefined as string | undefined,
    };

    it('is absent when the Campaign is not `wakaf` (ikrarWakaf prop omitted)', () => {
      render(<DonationConfirmation {...defaultProps} />);
      expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    });

    it('shows the nazhir and purpose, unchecked by default', () => {
      render(<DonationConfirmation {...defaultProps} ikrarWakaf={ikrarWakaf} />);
      expect(screen.getByText(/berikrar mewakafkan donasi ini/i)).toBeInTheDocument();
      // The purpose (the Campaign title) appears here and in the summary above.
      expect(screen.getAllByText((_, node) => node?.textContent === 'Bantu Korban Banjir Jakarta').length).toBeGreaterThan(0);
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes).toHaveLength(2);
      expect(checkboxes[0]).not.toBeChecked();
    });

    it('calls onToggle when the ikrar checkbox changes', () => {
      const onToggle = vi.fn();
      render(<DonationConfirmation {...defaultProps} ikrarWakaf={{ ...ikrarWakaf, onToggle }} />);
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);
      expect(onToggle).toHaveBeenCalledWith(true);
    });

    it('shows the error message when given one', () => {
      render(
        <DonationConfirmation
          {...defaultProps}
          ikrarWakaf={{ ...ikrarWakaf, error: 'Konfirmasi ikrar wakaf harus dicentang' }}
        />,
      );
      expect(screen.getByText('Konfirmasi ikrar wakaf harus dicentang')).toBeInTheDocument();
    });
  });

  it('disables button when isSubmitting is true', () => {
    render(<DonationConfirmation {...defaultProps} isSubmitting={true} />);
    expect(screen.getByRole('button', { name: /donasi sekarang/i })).toBeDisabled();
  });

  it('prevents double-submit by not calling onConfirm when isSubmitting', () => {
    const onConfirm = vi.fn();
    render(<DonationConfirmation {...defaultProps} onConfirm={onConfirm} isSubmitting={true} />);
    fireEvent.click(screen.getByRole('button', { name: /donasi sekarang/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
