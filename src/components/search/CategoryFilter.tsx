'use client';

interface CategoryFilterProps {
  categories: { id: string; name: string; slug: string }[];
  activeSlug: string | null;
  onSelect: (slug: string | null) => void;
}

export function CategoryFilter({ categories, activeSlug, onSelect }: CategoryFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      <button
        onClick={() => onSelect(null)}
        className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
          activeSlug === null
            ? 'bg-primary text-white'
            : 'bg-gray-100 text-text-secondary hover:bg-gray-200'
        }`}
      >
        Semua
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.slug === activeSlug ? null : cat.slug)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            cat.slug === activeSlug
              ? 'bg-primary text-white'
              : 'bg-gray-100 text-text-secondary hover:bg-gray-200'
          }`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
