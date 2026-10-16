'use client';

import { useEffect, useState } from 'react';

export interface ProgressBarProps {
  /** Collected amount */
  current: number;
  /** Target amount */
  target: number;
  /** Show percentage text */
  showLabel?: boolean;
  /** Height variant */
  size?: 'sm' | 'md';
  /** Animate fill on mount */
  animated?: boolean;
  /** Accessible name; defaults to "Progres penggalangan dana" */
  label?: string;
}

/**
 * Calculates percentage from current and target values.
 * Never exceeds 100%, never negative.
 * Returns 0 if target is 0 or negative values are provided.
 */
export function calculatePercentage(current: number, target: number): number {
  if (target <= 0) return 0;
  if (current < 0) return 0;
  return Math.min((current / target) * 100, 100);
}

export function ProgressBar({
  current,
  target,
  showLabel = false,
  size = 'md',
  animated = false,
  label = 'Progres penggalangan dana',
}: ProgressBarProps) {
  const percentage = calculatePercentage(current, target);
  // Only the animated bar keeps a width of its own: it starts empty and fills
  // to the percentage shortly after mount. A static bar just shows the percentage.
  const [animatedWidth, setAnimatedWidth] = useState(0);

  useEffect(() => {
    if (!animated) return;
    // Trigger animation on mount by setting width after initial render
    const timeout = setTimeout(() => {
      setAnimatedWidth(percentage);
    }, 50);
    return () => clearTimeout(timeout);
  }, [animated, percentage]);

  const width = animated ? animatedWidth : percentage;

  const heightClass = size === 'sm' ? 'h-1.5' : 'h-2.5';

  const rounded = Math.round(percentage);

  // One continuous bar: a flat neutral track with a single brand-gradient fill.
  // No stripes, dashes or tick marks, so the card, detail page and every other
  // call site render the same shape.
  return (
    <div className="w-full">
      <div
        className={`w-full ${heightClass} rounded-full overflow-hidden bg-border`}
        role="progressbar"
        aria-label={label}
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${rounded}% terkumpul`}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${width}%`,
            background: 'linear-gradient(90deg, var(--color-accent), var(--color-danger))',
            transition: animated ? 'width 600ms ease-in-out' : 'none',
          }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-text-secondary mt-1 block">
          {rounded}%
        </span>
      )}
    </div>
  );
}

export default ProgressBar;
