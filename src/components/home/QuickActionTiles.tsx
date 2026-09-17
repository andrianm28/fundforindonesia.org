import Link from "next/link";

export interface QuickActionTilesProps {
  tiles: {
    icon: string;
    label: string;
    href: string;
    color: string;
  }[];
}

export default function QuickActionTiles({ tiles }: QuickActionTilesProps) {
  return (
    <section className="px-4 py-4">
      <div className="grid grid-cols-4 gap-3 sm:gap-4 md:grid-cols-5 lg:grid-cols-8">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="flex flex-col items-center gap-2 group"
          >
            <div
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-xl sm:text-2xl transition-transform duration-normal group-hover:scale-105"
              style={{ backgroundColor: tile.color }}
            >
              <span role="img" aria-label={tile.label}>
                {tile.icon}
              </span>
            </div>
            <span className="text-[11px] sm:text-xs text-text text-center leading-tight font-medium line-clamp-2">
              {tile.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
