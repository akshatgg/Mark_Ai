"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin } from "lucide-react";

interface GoogleMapsEmbedProps {
  title?: string;
  description?: string;
  mapId: string;
  width?: string;
  height?: string;
  className?: string;
}

const GoogleMapsEmbed: React.FC<GoogleMapsEmbedProps> = ({
  title = "Our Screen Locations",
  description = "Explore all available digital screens across major cities",
  mapId = "1nmvPRNvI2rFnUkQ9QqHJPBmOXj-2hg0",
  width = "100%",
  height = "500",
  className = "",
}) => {
  return (
    <div className={`w-full py-12 transition-colors duration-300 ${className}`} style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div className="w-[92%] md:w-[85%] mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-3">
            <MapPin className="w-6 h-6 text-[var(--brand-blue)]" />
            <h2
              className="text-3xl md:text-4xl font-bold heading-font transition-colors duration-300"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </h2>
          </div>
          <p
            className="text-sm md:text-base transition-colors duration-300 max-w-2xl mx-auto"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {description}
          </p>
        </div>

        {/* Google Maps Card */}
        <Card
          className="overflow-hidden transition-all duration-300"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-primary)',
          }}
        >
          <CardContent className="p-0">
            <div
              style={{
                width: width,
                height: height,
                borderRadius: '0.75rem',
                overflow: 'hidden',
              }}
            >
              <iframe
                src={`https://www.google.com/maps/d/embed?mid=${mapId}&ehbc=2E312F&noprof=1`}
                width={width}
                height={height}
                style={{
                  border: 'none',
                  borderRadius: '0.75rem',
                  width: width,
                  height: height,
                }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Screen Locations Map"
              />
            </div>
          </CardContent>
        </Card>

        {/* Info Text */}
        <div
          className="text-center text-xs md:text-sm transition-colors duration-300 space-y-2"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <p>🗺️ Click on any location marker to view screen details and booking information</p>
          <p>📍 Use the search and filter options in the map to find screens in your area</p>
        </div>
      </div>
    </div>
  );
};

export default GoogleMapsEmbed;
