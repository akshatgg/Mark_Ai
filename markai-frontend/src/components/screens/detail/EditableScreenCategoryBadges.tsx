"use client";

import { useState, useEffect } from "react";
import { Edit2, Save, X, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

type EditableScreenCategoryBadgesProps = {
  categories: string[];
  screenId: string;
  isAdmin: boolean;
  onUpdate: (updatedCategories: string[]) => Promise<void>;
};

export const EditableScreenCategoryBadges = ({
  categories,
  screenId,
  isAdmin,
  onUpdate,
}: EditableScreenCategoryBadgesProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedCategories, setEditedCategories] = useState<string[]>(categories);
  const [newCategory, setNewCategory] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Sync local state when categories prop changes
  useEffect(() => {
    setEditedCategories(categories);
  }, [categories]);

  const handleAddCategory = () => {
    if (newCategory.trim() && !editedCategories.includes(newCategory.trim())) {
      setEditedCategories([...editedCategories, newCategory.trim()]);
      setNewCategory("");
    }
  };

  const handleRemoveCategory = (categoryToRemove: string) => {
    setEditedCategories(editedCategories.filter(cat => cat !== categoryToRemove));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate(editedCategories);
      toast.success("Categories updated successfully");
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update categories:", error);
      toast.error("Failed to update categories");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedCategories(categories);
    setNewCategory("");
    setIsEditing(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p
          className="text-sm uppercase tracking-widest transition-colors duration-300"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Categories
        </p>
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
                  color: 'var(--text-primary)',
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
                    color: 'var(--text-primary)',
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
                    color: 'var(--bg-primary)',
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

      {isEditing ? (
        <div className="space-y-3">
          {/* Existing categories */}
          <div className="flex flex-wrap gap-2">
            {editedCategories.map((category, index) => (
              <div
                key={`${category}-${index}`}
                className="inline-flex items-center gap-2 rounded-full border px-4 py-1 text-xs uppercase tracking-wide transition-colors duration-300"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>{category}</span>
                <button
                  onClick={() => handleRemoveCategory(category)}
                  className="hover:text-red-500 transition-colors"
                  type="button"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Add new category input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCategory();
                }
              }}
              className="flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors duration-300"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
              }}
              placeholder="Add new category..."
            />
            <button
              onClick={handleAddCategory}
              className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors duration-300 text-sm"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
              }}
              type="button"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {categories.map((category) => (
            <span
              key={category}
              className="rounded-full border px-4 py-1 text-xs uppercase tracking-wide transition-colors duration-300"
              style={{
                borderColor: 'var(--border-primary)',
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-secondary)',
              }}
            >
              {category}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
