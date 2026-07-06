"use client";

import Image from "next/image";
import { Dispatch, SetStateAction } from "react";
import { Play, Star, Monitor } from "lucide-react";
import { ScreenDetail } from "@/data/screens";
import { cn } from "@/lib/utils";

const FALLBACK_IMAGE = "/background.jpg";

type ScreenGalleryProps = {
  screen: ScreenDetail;
  activeImage: string;
  setActiveImage: Dispatch<SetStateAction<string>>;
};

export const ScreenGallery = ({ screen, activeImage, setActiveImage }: ScreenGalleryProps) => {
  // Use fallback if activeImage is empty
  const displayImage = activeImage || screen.hero || screen.gallery?.[0] || FALLBACK_IMAGE;

  // Filter out empty gallery images
  const validGallery = (screen.gallery || []).filter((img) => img && img.trim() !== "");

  return (
    <div className="space-y-6">
      <div
        className="relative w-full overflow-hidden rounded-3xl border aspect-4/3 transition-colors duration-300"
        style={{
          borderColor: 'var(--border-primary)',
          backgroundColor: 'var(--bg-card)'
        }}
      >
        {displayImage ? (
          <Image
            src={displayImage}
            alt={screen.name}
            fill
            className="object-cover"
            priority
            unoptimized
            onError={(e) => {
              (e.target as HTMLImageElement).src = FALLBACK_IMAGE;
            }}
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center transition-colors duration-300"
            style={{ backgroundColor: 'var(--bg-card)' }}
          >
            <Monitor
              className="w-16 h-16 transition-colors duration-300"
              style={{ color: 'var(--text-tertiary)' }}
            />
          </div>
        )}
        <div className="absolute inset-x-6 bottom-6 flex flex-wrap items-center gap-3 text-xs md:text-sm">
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur transition-colors duration-300"
            style={{ backgroundColor: 'var(--bg-primary)' }}
          >
            <Star className="w-4 h-4 text-yellow-300" />
            <span
              className="font-semibold transition-colors duration-300"
              style={{ color: 'var(--text-primary)' }}
            >
              {screen.rating}
            </span>
            <span
              className="transition-colors duration-300"
              style={{ color: 'var(--text-secondary)' }}
            >
              ({screen.reviews} reviews)
            </span>
          </div>
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur transition-colors duration-300"
            style={{ backgroundColor: 'var(--bg-primary)' }}
          >
            <Play className="w-4 h-4 text-purple-300" />
            <span
              className="transition-colors duration-300"
              style={{ color: 'var(--text-secondary)' }}
            >
              Loop-ready creative supported
            </span>
          </div>
        </div>
      </div>

      {validGallery.length > 0 && (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {validGallery.map((image, index) => (
            <button
              key={`${image}-${index}`}
              onMouseEnter={() => setActiveImage(image)}
              onFocus={() => setActiveImage(image)}
              onClick={() => setActiveImage(image)}
              className={cn(
                "relative h-24 w-32 shrink-0 overflow-hidden rounded-2xl border transition-colors duration-300",
              )}
              style={{
                borderColor: activeImage === image ? 'var(--border-secondary)' : 'var(--border-primary)'
              }}
            >
              <Image
                src={image || FALLBACK_IMAGE}
                alt={`${screen.name} ${index + 1}`}
                fill
                className="object-cover"
                unoptimized
                onError={(e) => {
                  (e.target as HTMLImageElement).src = FALLBACK_IMAGE;
                }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

