"use client";

import { useState } from "react";
import { Edit2, Save, X, Clock, Users, MapPin, Home } from "lucide-react";

interface VenueSnapshot {
  hours: string;
  dailyVisitors: string;
  screenPosition: string;
  environment: string;
}

type EditableScreenVenueSnapshotProps = {
  venue: VenueSnapshot;
  screenId: string;
  isAdmin: boolean;
  onUpdate: (updatedVenue: {
    operating_hours: string;
    avg_daily_visitors: string;
    screen_position: string;
    environment: string;
  }) => Promise<void>;
};

export const EditableScreenVenueSnapshot = ({
  venue,
  screenId,
  isAdmin,
  onUpdate
}: EditableScreenVenueSnapshotProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedHours, setEditedHours] = useState(venue.hours);
  const [editedDailyVisitors, setEditedDailyVisitors] = useState(venue.dailyVisitors);
  const [editedScreenPosition, setEditedScreenPosition] = useState(venue.screenPosition);
  const [editedEnvironment, setEditedEnvironment] = useState(venue.environment);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate({
        operating_hours: editedHours,
        avg_daily_visitors: editedDailyVisitors,
        screen_position: editedScreenPosition,
        environment: editedEnvironment,
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update venue snapshot:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedHours(venue.hours);
    setEditedDailyVisitors(venue.dailyVisitors);
    setEditedScreenPosition(venue.screenPosition);
    setEditedEnvironment(venue.environment);
    setIsEditing(false);
  };

  const items = [
    {
      icon: Clock,
      label: "Operating hours",
      value: isEditing ? editedHours : venue.hours,
      onChange: setEditedHours
    },
    {
      icon: Users,
      label: "Loop",
      value: isEditing ? editedDailyVisitors : venue.dailyVisitors,
      onChange: setEditedDailyVisitors
    },
    {
      icon: MapPin,
      label: "Screen position",
      value: isEditing ? editedScreenPosition : venue.screenPosition,
      onChange: setEditedScreenPosition
    },
    {
      icon: Home,
      label: "Environment",
      value: isEditing ? editedEnvironment : venue.environment,
      onChange: setEditedEnvironment
    },
  ];

  return (
    <div
      className="rounded-3xl border p-6 space-y-4 transition-colors duration-300"
      style={{
        borderColor: 'var(--border-primary)',
        backgroundColor: 'var(--bg-card)'
      }}
    >
      <div className="flex items-center justify-between">
        <h3
          className="text-2xl font-semibold heading-font transition-colors duration-300"
          style={{ color: 'var(--text-primary)' }}
        >
          Venue Snapshot
        </h3>

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

      <div
        className="grid grid-cols-1 gap-3 text-sm transition-colors duration-300"
        style={{ color: 'var(--text-secondary)' }}
      >
        {items.map(({ icon: Icon, label, value, onChange }) => (
          <div key={label} className="space-y-1">
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4" />
              <span className="text-xs font-medium transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                {label}
              </span>
            </div>
            {isEditing ? (
              <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors duration-300"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-primary)',
                  color: 'var(--text-primary)'
                }}
                placeholder={label}
              />
            ) : (
              <p className="pl-6 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                {value}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
