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
}: ProgressBarProps) {
  const percentage = calculatePercentage(current, target);
  const [width, setWidth] = useState(animated ? 0 : percentage);

  useEffect(() => {
    if (animated) {
      // Trigger animation on mount by setting width after initial render
      const timeout = setTimeout(() => {
        setWidth(percentage);
      }, 50);
      return () => clearTimeout(timeout);
    } else {
      setWidth(percentage);
    }
  }, [animated, percentage]);

  const heightClass = size === 'sm' ? 'h-1.5' : 'h-2.5';

  return (
    <div className="w-full">
      <div
        className={`w-full ${heightClass} rounded-full bg-bg-secondary overflow-hidden`}
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`${heightClass} rounded-full`}
          style={{
            width: `${width}%`,
            background: 'linear-gradient(90deg, #FF6B35, #D50000)',
            transition: animated ? 'width 600ms ease-in-out' : 'none',
          }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-text-secondary mt-1 block">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  );
}

export default ProgressBar;
