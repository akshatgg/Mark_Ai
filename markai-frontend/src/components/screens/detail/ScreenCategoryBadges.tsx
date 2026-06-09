"use client";

type ScreenCategoryBadgesProps = {
  categories: string[];
};

export const ScreenCategoryBadges = ({ categories }: ScreenCategoryBadgesProps) => {
  return (
    <div className="flex flex-wrap gap-3">
      {categories.map((category) => (
        <span
          key={category}
          className="rounded-full border px-4 py-1 text-xs uppercase tracking-wide transition-colors duration-300"
          style={{
            borderColor: 'var(--border-primary)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--text-secondary)'
          }}
        >
          {category}
        </span>
      ))}
    </div>
  );
};

