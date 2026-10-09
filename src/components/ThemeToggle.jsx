import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../theme.js';

export default function ThemeToggle({ className = '', compact = false }) {
  const [theme, setTheme] = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'โหมดสว่าง' : 'โหมดมืด';
  const Icon = isDark ? Sun : Moon;
  return <button
    type="button"
    className={`theme-toggle ${compact ? 'theme-toggle-compact' : ''} ${className}`.trim()}
    aria-label="สลับโหมดสี"
    aria-pressed={isDark}
    title={`เปลี่ยนเป็น${label}`}
    onClick={() => setTheme(isDark ? 'light' : 'dark')}
  >
    <Icon size={17} aria-hidden="true" />
    <span>{label}</span>
  </button>;
}
