'use client';
import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { Sun, Moon } from 'lucide-react';

const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="fixed top-24 right-6 z-50 p-3 rounded-full backdrop-blur-xl bg-white/10 dark:bg-white/5 border border-white/20 dark:border-white/10 hover:bg-white/20 dark:hover:bg-white/10 transition-all duration-300 shadow-lg hover:shadow-xl group"
      aria-label="Toggle theme"
    >
      <div className="relative w-6 h-6">
        {theme === 'dark' ? (
          <Moon className="w-6 h-6 text-blue-400 transition-transform duration-300 group-hover:rotate-12" />
        ) : (
          <Sun className="w-6 h-6 text-yellow-500 transition-transform duration-300 group-hover:rotate-90" />
        )}
      </div>
    </button>
  );
};

export default ThemeToggle;
