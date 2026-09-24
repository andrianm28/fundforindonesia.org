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
  /**
   * Renders the Ledger Line motif on the track: a dashed gold
   * repeating-linear-gradient background plus three fixed milestone
   * ticks at 25/50/75%, independent of the real current/target values.
   * This is a promise about the platform's staged-disbursement process,
   * not a report on this specific campaign's real progress -- the real
   * progress fill bar still renders on top, unchanged. Defaults to false
   * so every existing call site renders exactly as it did before.
   */
  showLedgerLine?: boolean;
}

const LEDGER_MILESTONE_POSITIONS = [25, 50, 75] as const;

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
  showLedgerLine = false,
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
        className={`w-full ${heightClass} rounded-full overflow-hidden ${
          showLedgerLine ? 'relative' : 'bg-bg-secondary'
        }`}
        style={
          showLedgerLine
            ? {
                backgroundImage:
                  'repeating-linear-gradient(90deg, var(--color-ledger) 0 4px, transparent 4px 8px)',
              }
            : undefined
        }
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {showLedgerLine &&
          LEDGER_MILESTONE_POSITIONS.map((position) => (
            <span
              key={position}
              data-testid="ledger-tick"
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-0.5 z-20"
              style={{
                left: `${position}%`,
                backgroundColor: 'var(--color-ledger)',
                boxShadow: '0 0 0 1px #FDFBF8',
              }}
            />
          ))}
        <div
          className={`${heightClass} rounded-full ${showLedgerLine ? 'relative z-10' : ''}`}
          style={{
            width: `${width}%`,
            background: 'linear-gradient(90deg, #D97748, #D50000)',
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
