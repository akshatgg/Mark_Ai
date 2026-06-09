"use client";

import { useState } from "react";
import { Edit2, Save, X } from "lucide-react";
import { ScreenMetrics as ScreenMetricsType } from "@/data/screens";

type EditableScreenMetricsProps = {
  metrics: ScreenMetricsType;
  screenId: string;
  isAdmin: boolean;
  location: string;
  onUpdate: (updatedMetrics: { footfall: string }) => Promise<void>;
};

export const EditableScreenMetrics = ({
  metrics,
  screenId,
  isAdmin,
  location,
  onUpdate
}: EditableScreenMetricsProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedFootfall, setEditedFootfall] = useState(metrics.footfall);
  const [isSaving, setIsSaving] = useState(false);

  const metricItems = [
    {
      label: "Footfall",
      value: isEditing ? editedFootfall : metrics.footfall,
      isEditable: true,
      onChange: (val: string) => setEditedFootfall(val)
    },
    {
      label: "Location",
      value: location,
      isEditable: false,
      onChange: (val: string) => {}
    },
  ];

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate({
        footfall: editedFootfall
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update metrics:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedFootfall(metrics.footfall);
    setIsEditing(false);
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end gap-2">
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-300 text-sm"
              style={{
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-primary)'
              }}
            >
              <Edit2 className="w-4 h-4" />
              Edit Metrics
            </button>
          ) : (
            <>
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-300 text-sm"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)'
                }}
                disabled={isSaving}
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-300 text-sm"
                style={{
                  backgroundColor: 'var(--text-primary)',
                  color: 'var(--bg-primary)'
                }}
                disabled={isSaving}
              >
                <Save className="w-4 h-4" />
                {isSaving ? "Saving..." : "Save"}
              </button>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {metricItems.map((metric) => (
          <div
            key={metric.label}
            className="rounded-2xl border p-4 transition-colors duration-300"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--bg-card)'
            }}
          >
            <p
              className="text-sm mb-1 transition-colors duration-300"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {metric.label}
            </p>
            {isEditing && metric.isEditable ? (
              <input
                type="text"
                value={metric.value}
                onChange={(e) => metric.onChange(e.target.value)}
                className="w-full text-xl font-semibold border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 transition-colors duration-300"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-primary)',
                  color: 'var(--text-primary)'
                }}
              />
            ) : (
              <p
                className="text-xl font-semibold transition-colors duration-300"
                style={{ color: 'var(--text-primary)' }}
              >
                {metric.value}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
