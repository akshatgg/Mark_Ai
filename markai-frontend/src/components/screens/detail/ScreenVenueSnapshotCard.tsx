"use client";

import { Clock, Users, MapPin, Home } from "lucide-react";
import { ScreenVenueSnapshot } from "@/data/screens";

type ScreenVenueSnapshotCardProps = {
  venue: ScreenVenueSnapshot;
};

export const ScreenVenueSnapshotCard = ({ venue }: ScreenVenueSnapshotCardProps) => {
  const items = [
    { icon: Clock, label: "Operating hours", text: venue.hours },
    { icon: Users, label: "Average daily visitors", text: venue.dailyVisitors },
    { icon: MapPin, label: "Screen position", text: venue.screenPosition },
    { icon: Home, label: "Environment", text: venue.environment },
  ];

  return (
    <div
      className="rounded-3xl border p-6 space-y-4 transition-colors duration-300"
      style={{
        borderColor: 'var(--border-primary)',
        backgroundColor: 'var(--bg-card)'
      }}
    >
      <h3
        className="text-2xl font-semibold heading-font transition-colors duration-300"
        style={{ color: 'var(--text-primary)' }}
      >
        Venue Snapshot
      </h3>
      <div
        className="grid grid-cols-1 gap-3 text-sm transition-colors duration-300"
        style={{ color: 'var(--text-secondary)' }}
      >
        {items.map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3">
            <Icon className="w-4 h-4" />
            <p>{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

