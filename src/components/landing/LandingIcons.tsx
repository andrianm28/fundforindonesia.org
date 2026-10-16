import type { ReactNode } from 'react';

/**
 * Line icons for the landing cards (Wakaf categories, CSR pillars). Inline
 * SVG in the same 24px stroke style as the Kontak page icons, so the site
 * needs no icon library. Decorative: the card title carries the meaning.
 */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="w-7 h-7"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function MosqueIcon() {
  return (
    <Icon>
      <path d="M12 3c-2.5 2-5 3.5-5 6.5V11h10V9.5C17 6.5 14.5 5 12 3z" />
      <path d="M12 1.5V3" />
      <path d="M4 21V11h16v10" />
      <path d="M2 21h20" />
      <path d="M10 21v-4a2 2 0 014 0v4" />
      <path d="M4 11V7.5M20 11V7.5" />
    </Icon>
  );
}

export function SchoolIcon() {
  return (
    <Icon>
      <path d="M12 3L2 8l10 5 10-5-10-5z" />
      <path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" />
      <path d="M22 8v6" />
    </Icon>
  );
}

export function HealthIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M12 7.5v9M7.5 12h9" />
    </Icon>
  );
}

export function PublicFacilityIcon() {
  return (
    <Icon>
      <path d="M3 9.5L12 4l9 5.5" />
      <path d="M4 9.5h16" />
      <path d="M6 9.5V18M10 9.5V18M14 9.5V18M18 9.5V18" />
      <path d="M3 21h18M4 18h16" />
    </Icon>
  );
}

export function LeafIcon() {
  return (
    <Icon>
      <path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15" />
      <path d="M5 19l7-7" />
    </Icon>
  );
}

export function AccessibilityIcon() {
  return (
    <Icon>
      <circle cx="12" cy="4.5" r="1.75" />
      <path d="M5 8.5l7 1.5 7-1.5" />
      <path d="M12 10v4.5l-3.5 6.5M12 14.5l3.5 6.5" />
    </Icon>
  );
}
