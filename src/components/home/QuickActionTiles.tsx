import Link from "next/link";
import type { QuickActionTile } from "@/lib/home/quickActionTiles";

export interface QuickActionTilesProps {
  tiles: QuickActionTile[];
}

export default function QuickActionTiles({ tiles }: QuickActionTilesProps) {
  return (
    // Named like its siblings (HeroBanner's "Hero banner carousel",
    // BottomNavBar's "Bottom navigation", PrayerWall's "Prayer Wall"): a bare
    // <section> is anonymous, and a screen reader reaching for the homepage's
    // menu needs to be able to say which region it is in.
    <section aria-label="Quick action tiles" className="px-4 py-4">
      <div className="grid grid-cols-5 gap-3 sm:gap-4">
        {tiles.map((tile) =>
          tile.comingSoon ? (
            <div key={tile.label} className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-xl sm:text-2xl bg-bg-secondary grayscale opacity-60">
                <span role="img" aria-label={tile.label}>
                  {tile.icon}
                </span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[11px] sm:text-xs text-text-secondary text-center leading-tight font-medium line-clamp-2 break-words">
                  {tile.label}
                </span>
                <span className="text-[10px] text-text-secondary">Segera hadir</span>
              </div>
            </div>
          ) : (
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
              <span className="text-[11px] sm:text-xs text-text text-center leading-tight font-medium line-clamp-2 break-words">
                {tile.label}
              </span>
            </Link>
          )
        )}
      </div>
    </section>
  );
}
