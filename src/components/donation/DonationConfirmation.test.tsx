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
  status: 'active',
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

  it('displays formatted fee', () => {
    render(<DonationConfirmation {...defaultProps} />);
    expect(screen.getByText('Rp2.500')).toBeInTheDocument();
  });

  it('displays formatted total (amount + fee)', () => {
    render(<DonationConfirmation {...defaultProps} />);
    // 50000 + 2500 = 52500
    expect(screen.getByText('Rp52.500')).toBeInTheDocument();
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
