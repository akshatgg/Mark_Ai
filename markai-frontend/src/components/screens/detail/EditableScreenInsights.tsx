"use client";

import { useState } from "react";
import { Sparkles, Edit2, Save, X, Plus, Trash2 } from "lucide-react";

type EditableScreenInsightsProps = {
  description: string;
  highlights: string[];
  screenId: string;
  isAdmin: boolean;
  onUpdate: (updatedHighlights: string[]) => Promise<void>;
};

export const EditableScreenInsights = ({
  description,
  highlights,
  screenId,
  isAdmin,
  onUpdate
}: EditableScreenInsightsProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedHighlights, setEditedHighlights] = useState<string[]>([...highlights]);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate(editedHighlights.filter(h => h.trim() !== ""));
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update insights:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedHighlights([...highlights]);
    setIsEditing(false);
  };

  const handleAddHighlight = () => {
    setEditedHighlights([...editedHighlights, ""]);
  };

  const handleRemoveHighlight = (index: number) => {
    setEditedHighlights(editedHighlights.filter((_, i) => i !== index));
  };

  const handleUpdateHighlight = (index: number, value: string) => {
    const updated = [...editedHighlights];
    updated[index] = value;
    setEditedHighlights(updated);
  };

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
          className="text-2xl md:text-3xl font-semibold heading-font transition-colors duration-300"
          style={{ color: 'var(--text-primary)' }}
        >
          Campaign Insights
        </h3>
        {isAdmin && !isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-300 text-sm"
            style={{
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)'
            }}
          >
            <Edit2 className="w-4 h-4" />
            Edit
          </button>
        )}
      </div>

      <p
        className="leading-relaxed transition-colors duration-300"
        style={{ color: 'var(--text-secondary)' }}
      >
        {description}
      </p>

      {isEditing && isAdmin && (
        <div className="flex gap-2">
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
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {(isEditing ? editedHighlights : highlights).map((highlight, index) => (
          <div
            key={index}
            className="flex items-start gap-3 rounded-2xl border p-4 transition-colors duration-300"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--bg-primary)'
            }}
          >
            <Sparkles className="w-5 h-5 text-purple-300 mt-1 shrink-0" />
            {isEditing ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={highlight}
                  onChange={(e) => handleUpdateHighlight(index, e.target.value)}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-colors duration-300"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)'
                  }}
                  placeholder="Enter insight..."
                />
                <button
                  onClick={() => handleRemoveHighlight(index)}
                  className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 transition-colors duration-300"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              </div>
            ) : (
              <p
                className="text-sm transition-colors duration-300"
                style={{ color: 'var(--text-secondary)' }}
              >
                {highlight}
              </p>
            )}
          </div>
        ))}
        {isEditing && (
          <button
            onClick={handleAddHighlight}
            className="flex items-center justify-center gap-3 rounded-2xl border border-dashed p-4 transition-colors duration-300"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--bg-primary)'
            }}
          >
            <Plus className="w-5 h-5 text-purple-300" />
            <p
              className="text-sm transition-colors duration-300"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Add Insight
            </p>
          </button>
        )}
      </div>
    </div>
  );
};
