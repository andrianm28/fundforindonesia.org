import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { CreateCampaignStepIndicator } from './CreateCampaignStepIndicator';

const steps = [
  { number: 1, label: 'Info Dasar' },
  { number: 2, label: 'Konten' },
  { number: 3, label: 'Review' },
];

describe('CreateCampaignStepIndicator', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders each upcoming/current step by its number', () => {
    render(<CreateCampaignStepIndicator steps={steps} currentStep={2} />);
    // Step 1 is completed (currentStep > 1) -- shows a checkmark, not "1".
    expect(screen.queryByText('1')).toBeNull();
    // Step 2 is current, step 3 is upcoming -- both show their literal number.
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
  });

  it('shows a checkmark instead of the number for a completed step', () => {
    const { container } = render(<CreateCampaignStepIndicator steps={steps} currentStep={2} />);
    expect(screen.queryByText('1')).toBeNull();
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(1);
  });

  it('sets every step number in the Record register mono typeface', () => {
    render(<CreateCampaignStepIndicator steps={steps} currentStep={1} />);
    expect(screen.getByText('1').className).toContain('font-mono');
    expect(screen.getByText('2').className).toContain('font-mono');
    expect(screen.getByText('3').className).toContain('font-mono');
  });

  it('sets every step label in small caps while staying in the everyday sans register', () => {
    render(<CreateCampaignStepIndicator steps={steps} currentStep={1} />);
    steps.forEach((step) => {
      const label = screen.getByText(step.label);
      expect(label.className).toContain('[font-variant:small-caps]');
      expect(label.className).not.toContain('font-serif');
    });
  });

  it('reflects however many steps it is given, never implying more exist', () => {
    const twoSteps = [
      { number: 1, label: 'Satu' },
      { number: 2, label: 'Dua' },
    ];
    render(<CreateCampaignStepIndicator steps={twoSteps} currentStep={1} />);
    expect(screen.getByText('Satu')).toBeDefined();
    expect(screen.getByText('Dua')).toBeDefined();
    expect(screen.queryByText('Review')).toBeNull();
  });

  it('renders exactly one connector between consecutive steps, and none after the last step', () => {
    const { container } = render(<CreateCampaignStepIndicator steps={steps} currentStep={1} />);
    const connectors = container.querySelectorAll('[data-testid="step-connector"]');
    expect(connectors).toHaveLength(steps.length - 1);
  });

  it('colors a connector as completed once its left-hand step is passed, and as pending otherwise', () => {
    const { container } = render(<CreateCampaignStepIndicator steps={steps} currentStep={2} />);
    const connectors = Array.from(
      container.querySelectorAll('[data-testid="step-connector"]')
    ) as HTMLElement[];
    // Between step 1 and step 2: currentStep(2) > step.number(1) -> completed/primary.
    expect(connectors[0].className).toContain('bg-primary');
    // Between step 2 and step 3: currentStep(2) > step.number(2) is false -> pending/border.
    expect(connectors[1].className).toContain('bg-border');
  });
});
