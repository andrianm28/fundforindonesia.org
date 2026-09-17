'use client';

import React from 'react';

export interface VerificationBadgeProps {
  /** The type of verification: KTP-based or organizational */
  verificationType: string | null;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Show tooltip on hover */
  showTooltip?: boolean;
  /** Optional additional className */
  className?: string;
}

/**
 * VerificationBadge displays a verification icon with tooltip
 * indicating the verification type (KTP/organization).
 * Matches kitabisa.com's green checkmark badge.
 *
 * Returns null when verificationType is null.
 */
export function VerificationBadge({
  verificationType,
  size = 'sm',
  showTooltip = true,
  className = '',
}: VerificationBadgeProps) {
  // Render nothing if not verified
  if (!verificationType) return null;

  const tooltipText =
    verificationType === 'organization'
      ? 'Organisasi terverifikasi'
      : 'Identitas terverifikasi (KTP)';

  const ariaLabel = tooltipText;

  return (
    <span
      className={`inline-flex items-center relative group${className ? ` ${className}` : ''}`}
      title={showTooltip ? tooltipText : undefined}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-label={ariaLabel}
      >
        <path
          fillRule="evenodd"
          d="M8.603 3.799A4.49 4.49 0 0112 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 013.498 1.307 4.491 4.491 0 011.307 3.497A4.49 4.49 0 0121.75 12a4.49 4.49 0 01-1.549 3.397 4.491 4.491 0 01-1.307 3.497 4.491 4.491 0 01-3.497 1.307A4.49 4.49 0 0112 21.75a4.49 4.49 0 01-3.397-1.549 4.49 4.49 0 01-3.498-1.306 4.491 4.491 0 01-1.307-3.498A4.49 4.49 0 012.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 011.307-3.497 4.49 4.49 0 013.497-1.307zm7.007 6.387a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
          clipRule="evenodd"
          fill="#00C853"
        />
      </svg>
      {/* CSS-only tooltip */}
      <span
        role="tooltip"
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[10px] text-white bg-gray-800 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity"
      >
        {tooltipText}
      </span>
    </span>
  );
}

export default VerificationBadge;
