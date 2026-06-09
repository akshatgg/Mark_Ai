"use client";

import { MapPin, Star, Users } from "lucide-react";
import { ScreenDetail } from "@/data/screens";

type ScreenOverviewCardProps = {
  screen: ScreenDetail;
};

export const ScreenOverviewCard = ({ screen }: ScreenOverviewCardProps) => {
  return (
    <div className="space-y-3">
      <h1
        className="text-3xl md:text-4xl font-semibold heading-font leading-tight transition-colors duration-300"
        style={{ color: 'var(--text-primary)' }}
      >
        {screen.name}
      </h1>

      {/* Description Line */}
      <p
        className="text-sm leading-relaxed transition-colors duration-300"
        style={{ color: 'var(--text-secondary)' }}
      >
        Premium digital screen in a high-traffic café location, perfect for brand visibility during peak hours
      </p>

      <div
        className="flex flex-wrap items-center gap-4 text-sm transition-colors duration-300"
        style={{ color: 'var(--text-secondary)' }}
      >
        <span className="inline-flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          {screen.location}
        </span>
        <span className="flex items-center gap-2">
          <Users className="w-4 h-4" />
          Cafe · {screen.city}
        </span>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <span
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1 transition-colors duration-300"
          style={{
            borderColor: 'var(--border-primary)',
            color: 'var(--text-primary)'
          }}
        >
          <Star className="w-4 h-4 text-yellow-300" />
          {screen.rating}
        </span>
        <span
          className="transition-colors duration-300"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {screen.reviews} verified reviews
        </span>
      </div>
    </div>
  );
};

