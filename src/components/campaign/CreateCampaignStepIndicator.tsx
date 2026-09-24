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
