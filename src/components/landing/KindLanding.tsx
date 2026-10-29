import Link from 'next/link';
import type { ReactNode } from 'react';

export interface KindLandingAction {
  href: string;
  label: string;
}

export interface KindLandingProps {
  title: string;
  intro: string;
  /** Honest statement of where the module stands today (CONTEXT.md, launch Kinds). */
  status: string;
  sections: { heading: string; body: ReactNode }[];
  /** A closing block after the sections, such as the Wakaf land-wakaf invitation with its own buttons. */
  children?: ReactNode;
  primary?: KindLandingAction;
  secondary?: KindLandingAction;
}

/**
 * The shared shape of the Wakaf, Hibah and Kolaborasi CSR landings (ticket
 * 75; PRD §3): what the module is, where it stands today, and the one next
 * step. A landing never invites a visitor to give to a Campaign that cannot
 * exist yet, so the status box says what is and is not open.
 */
export function KindLanding({ title, intro, status, sections, children, primary, secondary }: KindLandingProps) {
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-3">{title}</h1>
      <p className="text-text-secondary leading-relaxed mb-6">{intro}</p>

      <aside
        aria-label="Status"
        className="rounded-lg border border-border bg-bg-secondary p-4 mb-8 text-sm text-text-secondary leading-relaxed"
      >
        <strong className="text-text">Status saat ini: </strong>
        {status}
      </aside>

      {sections.map((section) => (
        <section key={section.heading} className="mb-8">
          <h2 className="text-lg font-semibold text-text mb-2">{section.heading}</h2>
          <div className="text-text-secondary leading-relaxed space-y-2">{section.body}</div>
        </section>
      ))}

      {children}

      {(primary || secondary) && (
        <div className="flex flex-wrap gap-3">
          {primary && (
            <Link
              href={primary.href}
              className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              {primary.label}
            </Link>
          )}
          {secondary && (
            <Link
              href={secondary.href}
              className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-text hover:border-primary"
            >
              {secondary.label}
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
