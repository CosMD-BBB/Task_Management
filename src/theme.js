import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'room-theme';
const CHANGE_EVENT = 'room:theme-change';
let initialized = false;
let savedTheme = null;
let mediaQuery;

function storedPreference() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#10131b' : '#f5f6fb');
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function initTheme() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;
  savedTheme = storedPreference();
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(savedTheme || (mediaQuery.matches ? 'dark' : 'light'));
  const followSystem = (event) => {
    if (!savedTheme) applyTheme(event.matches ? 'dark' : 'light');
  };
  if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', followSystem);
  else mediaQuery.addListener(followSystem);
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    savedTheme = storedPreference();
    applyTheme(savedTheme || (mediaQuery.matches ? 'dark' : 'light'));
  });
}

export function getTheme() {
  initTheme();
  return typeof document === 'undefined' ? 'light' : document.documentElement.dataset.theme || 'light';
}

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  initTheme();
  savedTheme = theme;
  try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* The choice still works when browser storage is unavailable. */ }
  applyTheme(theme);
}

function subscribe(listener) {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'light');
  return [theme, setTheme];
}

initTheme();
