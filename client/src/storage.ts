// localStorage can throw (private mode, blocked site data); the game works without it.

const PREFIX = 'saniuta.';

export function load(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // not persisted, that's fine
  }
}
