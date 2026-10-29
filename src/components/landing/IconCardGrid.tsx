import Link from 'next/link';
import type { ReactNode } from 'react';

export interface IconCard {
  icon: ReactNode;
  title: string;
  description: string;
  /** Where the card leads, with the link's own label; a card without one is not a link. */
  link?: { href: string; label: string };
}

/**
 * A grid of icon cards for a landing section: the Wakaf categories and the
 * CSR pillars. Each card is a list item, so a screen reader hears how many
 * options there are.
 */
export function IconCardGrid({ cards }: { cards: IconCard[] }) {
  return (
    <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2">
      {cards.map((card) => (
        <li key={card.title} className="rounded-xl border border-border bg-white p-5 flex flex-col gap-3">
          <span className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            {card.icon}
          </span>
          <h3 className="text-base font-semibold text-text">{card.title}</h3>
          <p className="text-sm text-text-secondary leading-relaxed">{card.description}</p>
          {card.link && (
            <Link href={card.link.href} className="mt-auto text-sm font-semibold text-primary hover:underline">
              {card.link.label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
