"use client";

import { useState } from "react";
import { Target, TrendingUp, CalendarDays, Edit2, Save, X } from "lucide-react";

interface TargetAudienceData {
  primary: string;
  affluence: string;
  occasions: string;
}

type EditableTargetAudienceCardProps = {
  data: TargetAudienceData;
  screenId: string;
  isAdmin: boolean;
  onUpdate: (updatedData: TargetAudienceData) => Promise<void>;
};

export const EditableTargetAudienceCard = ({
  data,
  screenId,
  isAdmin,
  onUpdate,
}: EditableTargetAudienceCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedPrimary, setEditedPrimary] = useState(data.primary);
  const [editedAffluence, setEditedAffluence] = useState(data.affluence);
  const [editedOccasions, setEditedOccasions] = useState(data.occasions);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate({
        primary: editedPrimary.trim(),
        affluence: editedAffluence.trim(),
        occasions: editedOccasions.trim(),
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update target audience:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedPrimary(data.primary);
    setEditedAffluence(data.affluence);
    setEditedOccasions(data.occasions);
    setIsEditing(false);
  };

  const items = [
    {
      icon: Target,
      label: "Primary",
      text: data.primary,
      editValue: editedPrimary,
      onChange: setEditedPrimary,
    },
    {
      icon: TrendingUp,
      label: "Affluence",
      text: data.affluence,
      editValue: editedAffluence,
      onChange: setEditedAffluence,
    },
    {
      icon: CalendarDays,
      label: "Occasions",
      text: data.occasions,
      editValue: editedOccasions,
      onChange: setEditedOccasions,
    },
  ];

  return (
    <div
      className="rounded-3xl border p-6 space-y-4 transition-colors duration-300"
      style={{
        borderColor: "var(--border-primary)",
        backgroundColor: "var(--bg-card)",
      }}
    >
      <div className="flex items-center justify-between">
        <h3
          className="text-2xl font-semibold heading-font transition-colors duration-300"
          style={{ color: "var(--text-primary)" }}
        >
          Target audience
        </h3>
        {isAdmin && (
          <div className="flex gap-2">
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors duration-300 text-xs"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor: "var(--border-primary)",
                  color: "var(--text-primary)",
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
                    backgroundColor: "var(--bg-card)",
                    borderWidth: "1px",
                    borderStyle: "solid",
                    borderColor: "var(--border-primary)",
                    color: "var(--text-primary)",
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
                    backgroundColor: "var(--text-primary)",
                    color: "var(--bg-primary)",
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
      <div className="space-y-3 text-sm">
        {items.map(({ icon: Icon, label, text, editValue, onChange }) => (
          <div key={label} className="space-y-1">
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-purple-400" />
              <span
                className="font-medium transition-colors duration-300"
                style={{ color: "var(--text-secondary)" }}
              >
                {label}:
              </span>
            </div>
            {isEditing ? (
              <textarea
                value={editValue}
                onChange={(e) => onChange(e.target.value)}
                className="w-full pl-6 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors duration-300 resize-none"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border-primary)",
                  color: "var(--text-primary)",
                }}
                rows={2}
              />
            ) : (
              <p
                className="pl-6 leading-relaxed transition-colors duration-300"
                style={{ color: "var(--text-primary)" }}
              >
                {text}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
