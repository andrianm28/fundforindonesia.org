import React from 'react';

export interface SkeletonProps {
  variant: 'text' | 'circular' | 'rectangular' | 'card';
  width?: string | number;
  height?: string | number;
  lines?: number;
  animated?: boolean;
  className?: string;
}

function getStyleValue(value?: string | number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return `${value}px`;
  return value;
}

/**
 * Skeleton component for loading placeholder states.
 * Supports shimmer animation for loading UX.
 */
export function Skeleton({
  variant,
  width,
  height,
  lines = 1,
  animated = true,
  className = '',
}: SkeletonProps) {
  const shimmerClass = animated ? 'skeleton-shimmer' : '';
  const baseClass = 'bg-[var(--color-bg-secondary)]';

  if (variant === 'text') {
    return (
      <div className={`flex flex-col gap-2 ${className}`} role="status" aria-label="Loading">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={`${baseClass} ${shimmerClass} rounded`}
            style={{
              width: i === lines - 1 && lines > 1 ? '75%' : getStyleValue(width) || '100%',
              height: getStyleValue(height) || '16px',
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === 'circular') {
    const size = getStyleValue(width) || '48px';
    return (
      <div
        className={`${baseClass} ${shimmerClass} rounded-full ${className}`}
        style={{
          width: size,
          height: size,
        }}
        role="status"
        aria-label="Loading"
      />
    );
  }

  if (variant === 'rectangular') {
    return (
      <div
        className={`${baseClass} ${shimmerClass} rounded-[var(--radius-sm)] ${className}`}
        style={{
          width: getStyleValue(width) || '100%',
          height: getStyleValue(height) || '100px',
        }}
        role="status"
        aria-label="Loading"
      />
    );
  }

  // card variant — campaign card skeleton layout
  if (variant === 'card') {
    return (
      <div
        className={`rounded-[var(--radius-md)] overflow-hidden shadow-[var(--shadow-card)] bg-white ${className}`}
        style={{ width: getStyleValue(width) || '100%' }}
        role="status"
        aria-label="Loading"
      >
        {/* Image area (16:9 aspect ratio) */}
        <div
          className={`${baseClass} ${shimmerClass} w-full`}
          style={{ paddingBottom: '56.25%' }}
        />
        {/* Content area */}
        <div className="p-3 flex flex-col gap-2">
          {/* Title - 2 lines */}
          <div
            className={`${baseClass} ${shimmerClass} rounded`}
            style={{ width: '100%', height: '14px' }}
          />
          <div
            className={`${baseClass} ${shimmerClass} rounded`}
            style={{ width: '70%', height: '14px' }}
          />
          {/* Progress bar */}
          <div
            className={`${baseClass} ${shimmerClass} rounded-full mt-1`}
            style={{ width: '100%', height: '8px' }}
          />
          {/* Amount and days */}
          <div className="flex justify-between items-center mt-1">
            <div
              className={`${baseClass} ${shimmerClass} rounded`}
              style={{ width: '40%', height: '12px' }}
            />
            <div
              className={`${baseClass} ${shimmerClass} rounded`}
              style={{ width: '25%', height: '12px' }}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default Skeleton;
