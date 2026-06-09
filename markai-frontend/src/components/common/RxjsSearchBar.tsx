"use client";
import React, { useState, useEffect, useRef } from "react";
import { Subject } from "rxjs";
import { debounceTime, distinctUntilChanged } from "rxjs/operators";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

interface RxjsSearchBarProps<T> {
  items: T[];
  onFilteredItems: (filteredItems: T[]) => void;
  filterFunction: (item: T, searchTerm: string) => boolean;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
}

export function RxjsSearchBar<T>({
  items,
  onFilteredItems,
  filterFunction,
  placeholder = "Search...",
  debounceMs = 300,
  className = "",
}: RxjsSearchBarProps<T>) {
  const [searchTerm, setSearchTerm] = useState("");
  const searchSubject = useRef(new Subject<string>());

  // RxJS search subscription
  useEffect(() => {
    const subscription = searchSubject.current
      .pipe(
        debounceTime(debounceMs), // Wait after user stops typing
        distinctUntilChanged() // Only emit when search term changes
      )
      .subscribe((term) => {
        if (!term.trim()) {
          // If search is empty, show all items
          onFilteredItems(items);
        } else {
          // Filter items based on search term
          const filtered = items.filter((item) => filterFunction(item, term.toLowerCase()));
          onFilteredItems(filtered);
        }
      });

    return () => subscription.unsubscribe();
  }, [items, filterFunction, onFilteredItems, debounceMs]);

  // Handle search input change using RxJS Subject
  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearchTerm(value);
    searchSubject.current.next(value);
  };

  // Clear search
  const handleClear = () => {
    setSearchTerm("");
    searchSubject.current.next("");
  };

  return (
    <div className={`relative ${className}`}>
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-300"
        style={{ color: "var(--text-tertiary)" }}
      />
      <Input
        type="text"
        placeholder={placeholder}
        value={searchTerm}
        onChange={handleSearchChange}
        className="pl-10 transition-colors duration-300"
        style={{
          backgroundColor: "var(--bg-card)",
          borderColor: "var(--border-primary)",
          color: "var(--text-primary)",
        }}
      />
      {searchTerm && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors duration-300 hover:opacity-70"
          style={{ color: "var(--text-tertiary)" }}
          title="Clear search"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// Hook to get current search term if needed
export function useSearchTerm() {
  const [searchTerm, setSearchTerm] = useState("");
  return { searchTerm, setSearchTerm };
}
