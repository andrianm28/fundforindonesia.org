# Ledger Line Campaign Creation Progress Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the campaign-creation flow's already-existing, already-honest step indicator the Record register treatment -- step numbers in the mono typeface (a number shown as stated fact), step labels in small caps -- so a Fundraiser senses from the first step that what they're building will be held to account, matching the discipline the rest of the platform's Ledger Line rollout applies.

**Architecture:** `src/app/campaign/create/page.tsx` is NOT a single page/form and NOT a multi-step-per-route wizard -- it is a single route with client-side `useState`-driven step state (`currentStep`, 1-3, fixed, unconditional) and an inline, already-correct numbered step indicator (numbered circles, checkmarks for completed steps, a connecting line, labels) rendered directly in the page's JSX (confirmed by reading the real 608-line file before this plan was written, per the ticket's own explicit first acceptance criterion). The indicator already reflects genuine, honest, ordered progress -- nothing about its LOGIC needs to change. What's missing is the Record register styling ticket 01 introduced (self-hosted JetBrains Mono / small-caps treatment), which this file uses nowhere today (grep-confirmed: zero `font-mono`/`font-serif`/small-caps anywhere in it). This plan extracts the indicator into its own component, `src/components/campaign/CreateCampaignStepIndicator.tsx`, both because that is this repo's own established pattern (`ProgressBar`, `VerificationBadge`, `CampaignCard` are all separately-tested, single-responsibility UI components) and because the page itself has no test file at all today and no way to reach steps 2/3 without driving real multi-field form validation through `userEvent` -- extracting a small, prop-driven component makes the indicator's own rendering logic (the only thing this ticket touches) directly and robustly testable, without touching or needing to exercise the page's validation/submission logic at all.

**Tech Stack:** Next.js 14, Tailwind CSS, React, Vitest.

**Spec:** .scratch/ledger-line-visual-refresh/issues/04-campaign-creation-progress-indicator.md (ticket; parent spec .scratch/ledger-line-visual-refresh/spec.md)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah
di bawah keluar dengan status 0.

    /home/ubuntu/.claude/skills/specflow/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-24-ledger-line-campaign-creation.md /home/ubuntu/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/task-brief
    /home/ubuntu/.claude/skills/specflow/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-24-ledger-line-campaign-creation.md /home/ubuntu/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- The progress indicator's numbering must be honest -- a real ordered sequence reflecting genuine progress through the page's actual structure, never decorative and never implying more steps exist than actually do. (Already true of the existing indicator's logic; this plan does not change that logic, only its typography.)
- Step numbers are set in the Record register's mono typeface (`font-mono`, self-hosted JetBrains Mono, wired by ticket 01) -- a number shown as a stated fact, per ticket 01's own rule for the mono register.
- Step labels are set in small caps (`font-variant: small-caps`, via Tailwind's arbitrary-property syntax) but stay in the everyday sans font -- a short UI label is not "prose that is a claim of record," so it does not switch to the serif register; only the number does the Record-register work here.
- No other element on the campaign-creation page (form inputs, buttons, the page title, category/date fields) picks up Record register styling -- the parent spec's own rule (gold token and Record register never on interactive controls) applies here: only the step indicator's own number/label carry the new typography.
- No change to routes, data model, or business logic -- validation (`validateStep1`/`validateStep2`), submission (`handleSubmit`), and the step-transition logic (`handleNext`/`handleBack`) are untouched by this plan.
- No visual-regression testing tool is introduced -- manual browser verification is the stated seam for the visual appearance itself.

---

### Task 1: Extract and restyle the campaign-creation step indicator in the Record register

**Files:**
- Create: `src/components/campaign/CreateCampaignStepIndicator.tsx`
- Create: `src/components/campaign/CreateCampaignStepIndicator.test.tsx`
- Modify: `src/app/campaign/create/page.tsx`

**Interfaces:**
- Produces: `CreateCampaignStepIndicator({ steps, currentStep }: CreateCampaignStepIndicatorProps)`, a default-exported React component. `CreateCampaignStepIndicatorProps` = `{ steps: CreateCampaignStep[]; currentStep: number }`. `CreateCampaignStep` = `{ number: number; label: string }`. Both types are exported (named exports) alongside the component.
- Consumes: nothing from another task (this is the only task in this plan).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `src/components/campaign/CreateCampaignStepIndicator.test.tsx` (a NEW component test suite -- `src/app/campaign/create/page.tsx` has no existing test file at all today, confirmed by search before this plan was written, so there is no pre-existing seam to preserve there; the parent spec's Testing Decisions section names existing component tests as the seam for this whole ticket set, and this task creates that seam for the one piece of this page it actually changes). Cakup SETIAP perilaku task ini MELALUI seam itu: every step's number carries the mono typeface regardless of whether it's upcoming, current, or completed; every step's label carries the small-caps treatment while staying off the serif register; the indicator honestly reflects however many steps it's given (not hardcoded to 3) and doesn't render a connector after the last step; a completed step shows a checkmark instead of its number, exactly as before this task. Helper internals are exercised only through rendering the component, never called directly. Nilai harapan dalam test adalah literal yang diketahui (`'1'`, `'2'`, step labels, `'font-mono'`, `'[font-variant:small-caps]'`), bukan dihitung ulang dari kode.

**Facts gathered (do not re-derive):**

`src/app/campaign/create/page.tsx`'s real structure (read in full, 608 lines, before this plan was written): a single route, `'use client'`, gated by `useSession()` (loading / unauthenticated-redirect / KYC-not-verified states) before rendering the form at all. The form itself is a single-page, client-side 3-step flow driven by `const [currentStep, setCurrentStep] = useState(1)` -- NOT one route per step, NOT `ffi`'s ~9-10 step wizard shape. The 3 steps are fixed and unconditional (no conditional sections that could change the step count) -- `validateStep1()` gates the Info-Dasar -> Konten transition, `validateStep2()` gates Konten -> Review, and `handleSubmit()` runs on the Review step. This plan does not touch any of that logic.

The exact current step-indicator block (`page.tsx` lines 270-320, immediately above the "Form Card" div) -- this is what gets extracted, verbatim in logic, restyled in the extraction:
```tsx
  // Step indicator
  const steps = [
    { number: 1, label: 'Info Dasar' },
    { number: 2, label: 'Konten' },
    { number: 3, label: 'Review' },
  ];

  return (
    <div className="min-h-screen bg-bg-secondary py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <h1 className="text-2xl font-bold text-text mb-6 text-center">
          Buat Campaign Penggalangan Dana
        </h1>

        {/* Step Indicator */}
        <div className="flex items-center justify-center mb-8">
          {steps.map((step, index) => (
            <React.Fragment key={step.number}>
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    currentStep >= step.number
                      ? 'bg-primary text-white'
                      : 'bg-border text-text-secondary'
                  }`}
                >
                  {currentStep > step.number ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    step.number
                  )}
                </div>
                <span className="text-xs mt-1 text-text-secondary">{step.label}</span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`w-16 h-0.5 mx-2 mb-4 ${
                    currentStep > step.number ? 'bg-primary' : 'bg-border'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-card p-6">
```
(The `{/* Form Card */}` div and everything inside it, through the rest of the 608-line file, is untouched by this task -- shown here only so the extraction's insertion point is unambiguous.)

`page.tsx`'s top imports (unchanged by this task except one new line added):
```tsx
'use client';

/* eslint-disable @next/next/no-img-element */
import React, { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
```
`React` (the namespace import) must stay -- it is also used for `React.ChangeEvent<HTMLInputElement>` in `handleImageChange`'s parameter type, elsewhere in the file this task doesn't touch.

No test file exists anywhere for `src/app/campaign/create/page.tsx` today (confirmed by search) -- this task does not add one; it tests the extracted `CreateCampaignStepIndicator` component directly instead, which is where this task's actual logic lives. `Input`'s label and the raw `<input type="date">`/`<select>` elsewhere on this page have no `id`/`htmlFor` association (an existing, pre-existing fact, not something this task fixes or needs to work around, since this task doesn't touch the form fields at all).

Tailwind arbitrary-property syntax (`[property:value]`) is supported by this repo's Tailwind version (3.4.1, confirmed via `package.json` during a prior ticket's review) -- `[font-variant:small-caps]` is valid.

- [ ] **Step 1: Write the failing tests for the extracted, restyled step indicator**

Create `src/components/campaign/CreateCampaignStepIndicator.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/components/campaign/CreateCampaignStepIndicator.test.tsx`
Expected: FAIL with a module-not-found error (`CreateCampaignStepIndicator.tsx` doesn't exist yet).

- [ ] **Step 3: Create `CreateCampaignStepIndicator.tsx`**

```tsx
import React from 'react';

export interface CreateCampaignStep {
  number: number;
  label: string;
}

export interface CreateCampaignStepIndicatorProps {
  steps: CreateCampaignStep[];
  currentStep: number;
}

/**
 * Numbered progress indicator for the campaign-creation flow, set in the
 * Record register: step numbers in the mono typeface (a number shown as a
 * stated fact, per ticket 01's rule), step labels in small caps -- staying
 * in the everyday sans font, since a short UI label is not prose-of-record.
 * Reflects exactly the steps and current position it's given; never implies
 * more steps exist than were passed in.
 */
export function CreateCampaignStepIndicator({
  steps,
  currentStep,
}: CreateCampaignStepIndicatorProps) {
  return (
    <div className="flex items-center justify-center mb-8">
      {steps.map((step, index) => (
        <React.Fragment key={step.number}>
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium font-mono ${
                currentStep >= step.number
                  ? 'bg-primary text-white'
                  : 'bg-border text-text-secondary'
              }`}
            >
              {currentStep > step.number ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                step.number
              )}
            </div>
            <span className="text-xs mt-1 text-text-secondary [font-variant:small-caps] tracking-wide">
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              data-testid="step-connector"
              className={`w-16 h-0.5 mx-2 mb-4 ${
                currentStep > step.number ? 'bg-primary' : 'bg-border'
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export default CreateCampaignStepIndicator;
```

- [ ] **Step 4: Run `CreateCampaignStepIndicator.test.tsx` to verify all tests pass**

Run: `npx vitest run src/components/campaign/CreateCampaignStepIndicator.test.tsx`
Expected: all 7 tests PASS.

- [ ] **Step 5: Wire `page.tsx` to use the extracted component**

In `src/app/campaign/create/page.tsx`:

1. Add the import, alongside the existing `Button`/`Input` imports:
```tsx
import { CreateCampaignStepIndicator } from '@/components/campaign/CreateCampaignStepIndicator';
```

2. Replace the entire `{/* Step Indicator */}` block (the `<div className="flex items-center justify-center mb-8">...</div>` shown in this task's "Facts gathered" section above, everything between `{/* Step Indicator */}` and the `{/* Form Card */}` comment) with:
```tsx
        {/* Step Indicator */}
        <CreateCampaignStepIndicator steps={steps} currentStep={currentStep} />
```

Nothing else in `page.tsx` changes -- the `const steps = [...]` array declaration, `currentStep` state, and every line of the form itself stay exactly as they are.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all test files PASS, including the new `CreateCampaignStepIndicator.test.tsx` and every other suite in the repo (this task touches no other component or route).

- [ ] **Step 7: Manual browser verification**

Start the dev server (`npm run dev`), log in as a verified user, and visit `/campaign/create`. Confirm:
- The step indicator's numbers render in the monospace Record-register typeface (JetBrains Mono), visually distinct from the rest of the page's sans-serif text.
- The step labels ("Info Dasar", "Konten", "Review") render in small caps.
- No other element on the page (title, inputs, buttons, category dropdown) picked up the mono or small-caps treatment.
- Walking through all 3 steps end-to-end (filling valid data, clicking "Lanjutkan" twice), the indicator updates correctly at each stage: the current step highlighted, prior steps showing a checkmark, exactly as it did before this task -- confirming the extraction didn't change the indicator's actual behavior, only its typography.

If the dev environment has no way to authenticate as a verified user, or another blocker prevents reaching this page, read the compiled/rendered output via the component test suite's DOM output as a documented substitute (proves the classes are wired, not real paint), and note the blocker explicitly in the task report -- do not silently skip this verification.

- [ ] **Step 8: Commit**

```bash
git add src/components/campaign/CreateCampaignStepIndicator.tsx src/components/campaign/CreateCampaignStepIndicator.test.tsx src/app/campaign/create/page.tsx
git commit -m "feat: set the campaign-creation step indicator in the Record register"
```
