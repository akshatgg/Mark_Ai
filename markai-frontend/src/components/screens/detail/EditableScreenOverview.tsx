"use client";

import { useState, useEffect } from "react";
import { MapPin, Star, Users, Edit2, Save, X } from "lucide-react";
import { ScreenDetail } from "@/data/screens";
import toast from "react-hot-toast";

type EditableScreenOverviewProps = {
  screen: ScreenDetail;
  screenId: string;
  isAdmin: boolean;
  description: string;
  onUpdate: (updatedData: {
    rating: number;
    verified_reviews: number;
  }) => Promise<void>;
  onUpdateLocation?: (updatedLocation: {
    street: string;
    city: string;
    state: string;
    country: string;
  }) => Promise<void>;
  onUpdateDescription?: (description: string) => Promise<void>;
  onUpdateScreenName?: (screenName: string) => Promise<void>;
  onUpdateCafeName?: (cafeName: string) => Promise<void>;
};

export const EditableScreenOverview = ({
  screen,
  screenId,
  isAdmin,
  description,
  onUpdate,
  onUpdateLocation,
  onUpdateDescription,
  onUpdateScreenName,
  onUpdateCafeName
}: EditableScreenOverviewProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedScreenName, setEditedScreenName] = useState(screen.name || "");
  const [editedCafeName, setEditedCafeName] = useState((screen as any).cafe_name || screen.name || "");
  const [editedRating, setEditedRating] = useState(screen.rating?.toString() || "4.8");
  const [editedReviews, setEditedReviews] = useState(screen.reviews?.toString() || "44");
  const [editedLocation, setEditedLocation] = useState((screen as any).street || "");
  const [editedDescription, setEditedDescription] = useState(description || "");
  const [isSaving, setIsSaving] = useState(false);

  // Sync local state when specific screen values change
  useEffect(() => {
    setEditedRating(screen.rating?.toString() || "4.8");
  }, [screen.rating]);

  useEffect(() => {
    setEditedReviews(screen.reviews?.toString() || "44");
  }, [screen.reviews]);

  useEffect(() => {
    setEditedLocation((screen as any).street || "");
  }, [(screen as any).street]);

  useEffect(() => {
    setEditedDescription(description || "");
  }, [description]);

  useEffect(() => {
    setEditedScreenName(screen.name || "");
  }, [screen.name]);

  useEffect(() => {
    setEditedCafeName((screen as any).cafe_name || screen.name || "");
  }, [(screen as any).cafe_name, screen.name]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const rating = parseFloat(editedRating) || 4.8;
      const reviews = parseInt(editedReviews) || 44;

      // Update rating and reviews
      await onUpdate({
        rating: Math.min(Math.max(rating, 0), 5), // Clamp between 0-5
        verified_reviews: Math.max(reviews, 0), // Ensure non-negative
      });

      // Update location if handler is provided
      if (onUpdateLocation) {
        await onUpdateLocation({
          street: editedLocation.trim(),
          city: screen.city || "",
          state: (screen as any).state || "",
          country: (screen as any).country || "",
        });
      }

      // Update description if handler is provided
      if (onUpdateDescription && editedDescription.trim() !== description) {
        await onUpdateDescription(editedDescription.trim());
      }

      // Update screen name if handler is provided
      if (onUpdateScreenName && editedScreenName.trim() !== screen.name) {
        await onUpdateScreenName(editedScreenName.trim());
      }

      // Update cafe name if handler is provided
      if (onUpdateCafeName && editedCafeName.trim() !== (screen as any).cafe_name) {
        await onUpdateCafeName(editedCafeName.trim());
      }

      toast.success("Screen updated successfully");
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update:", error);
      toast.error("Failed to update screen");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedScreenName(screen.name || "");
    setEditedCafeName((screen as any).cafe_name || screen.name || "");
    setEditedRating(screen.rating?.toString() || "4.8");
    setEditedReviews(screen.reviews?.toString() || "44");
    setEditedLocation((screen as any).street || "");
    setEditedDescription(description || "");
    setIsEditing(false);
  };

  return (
    <div className="space-y-3">
      {/* Screen Name */}
      {isEditing ? (
        <input
          type="text"
          value={editedScreenName}
          onChange={(e) => setEditedScreenName(e.target.value)}
          className="w-full px-3 py-2 text-3xl md:text-4xl font-semibold heading-font border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)] transition-colors duration-300"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-primary)',
            color: 'var(--text-primary)'
          }}
          placeholder="Enter cafe/screen name (e.g., Café Coffee Day)"
        />
      ) : (
        <h1
          className="text-3xl md:text-4xl font-semibold leading-tight transition-colors duration-300"
          style={{ color: 'var(--text-primary)' }}
        >
          {screen.name}
        </h1>
      )}

      {/* Description Line */}
      {isEditing ? (
        <textarea
          value={editedDescription}
          onChange={(e) => setEditedDescription(e.target.value)}
          className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)] transition-colors duration-300 resize-none"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-primary)',
            color: 'var(--text-primary)'
          }}
          rows={2}
          placeholder="Enter screen description..."
        />
      ) : (
        <p
          className="text-sm leading-relaxed transition-colors duration-300"
          style={{ color: 'var(--text-secondary)' }}
        >
          {description || "Premium digital screen in a high-traffic café location, perfect for brand visibility during peak hours"}
        </p>
      )}

      <div
        className="flex flex-wrap items-center gap-4 text-sm transition-colors duration-300"
        style={{ color: 'var(--text-secondary)' }}
      >
        {isEditing ? (
          <>
            {/* Location/Street Input */}
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <MapPin className="w-4 h-4 flex-shrink-0" />
              <input
                type="text"
                value={editedLocation}
                onChange={(e) => setEditedLocation(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)] transition-colors duration-300"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-primary)',
                  color: 'var(--text-primary)'
                }}
                placeholder="Street/Address"
              />
            </div>

            {/* Cafe Name Input */}
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Users className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">Cafe ·</span>
              <input
                type="text"
                value={editedCafeName}
                onChange={(e) => setEditedCafeName(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)] transition-colors duration-300"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-primary)',
                  color: 'var(--text-primary)'
                }}
                placeholder="Cafe name (e.g., Café Coffee Day)"
              />
            </div>

          </>
        ) : (
          <>
            {(screen as any).street && (
              <span className="inline-flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                {(screen as any).street}
              </span>
            )}
            <span className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Cafe · {(screen as any).cafe_name || screen.name}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm flex-1">
          {isEditing ? (
            <>
              {/* Rating Input */}
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-300" />
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="5"
                  value={editedRating}
                  onChange={(e) => setEditedRating(e.target.value)}
                  className="w-16 px-2 py-1 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)] transition-colors duration-300"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)'
                  }}
                  placeholder="4.8"
                />
              </div>

              {/* Reviews Input */}
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  value={editedReviews}
                  onChange={(e) => setEditedReviews(e.target.value)}
                  className="w-20 px-2 py-1 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)] transition-colors duration-300"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)'
                  }}
                  placeholder="44"
                />
                <span className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  verified reviews
                </span>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors duration-300 text-xs"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: 'var(--border-primary)',
                  color: 'var(--text-primary)'
                }}
              >
                <Edit2 className="w-3 h-3" />
                Edit
              </button>
            ) : (
              <>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors duration-300 text-xs"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)'
                  }}
                  disabled={isSaving}
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors duration-300 text-xs"
                  style={{
                    backgroundColor: 'var(--text-primary)',
                    color: 'var(--bg-primary)'
                  }}
                  disabled={isSaving}
                >
                  <Save className="w-3 h-3" />
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
