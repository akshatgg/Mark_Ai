"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

interface ScreenSearchBarProps {
  onSearch: (searchTerm: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
}

export const ScreenSearchBar: React.FC<ScreenSearchBarProps> = ({
  onSearch,
  placeholder = "Search by screen name, location, or city...",
  className = "",
  debounceMs = 500
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isActive, setIsActive] = useState(false);

  // Debounced search callback
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      onSearch(searchTerm);
    }, debounceMs);

    return () => clearTimeout(debounceTimer);
  }, [searchTerm, debounceMs, onSearch]);

  const handleClear = useCallback(() => {
    setSearchTerm("");
  }, []);

  return (
    <div className={`relative w-full ${className}`}>
      <div
        className="relative flex items-center transition-all duration-300 rounded-lg px-4 py-3 border backdrop-blur-md"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: isActive ? 'var(--text-primary)' : 'var(--border-primary)'
        }}
        onFocus={() => setIsActive(true)}
        onBlur={() => setIsActive(false)}
      >
        <Search
          className="w-5 h-5 transition-colors duration-300 shrink-0"
          style={{ color: 'var(--text-tertiary)' }}
        />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={() => setIsActive(true)}
          onBlur={() => setIsActive(false)}
          placeholder={placeholder}
          className="ml-3 flex-1 bg-transparent text-sm md:text-base outline-none placeholder-opacity-70 transition-colors duration-300"
          style={{
            color: 'var(--text-primary)',
            caretColor: 'var(--text-primary)',
            '--placeholder-opacity': '0.5'
          } as React.CSSProperties}
        />
        {searchTerm && (
          <button
            onClick={handleClear}
            onMouseDown={(e) => e.preventDefault()}
            className="ml-2 p-1 hover:opacity-70 transition-opacity duration-200 shrink-0"
            aria-label="Clear search"
          >
            <X
              className="w-4 h-4 transition-colors duration-300"
              style={{ color: 'var(--text-tertiary)' }}
            />
          </button>
        )}
      </div>
    </div>
  );
};
