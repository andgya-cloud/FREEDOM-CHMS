import { readPref, writePref } from './storage';

export type ThemeChoice = 'system' | 'light' | 'dark';

export function getTheme(): ThemeChoice {
  const t = readPref('theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function applyTheme(choice: ThemeChoice = getTheme()) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function setTheme(choice: ThemeChoice) {
  writePref('theme', choice === 'system' ? null : choice);
  applyTheme(choice);
}
