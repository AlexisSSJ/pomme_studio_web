// Session Bearer token. Held in memory for the current page session and
// mirrored to localStorage so it survives full page reloads (F5, hard
// navigation, new tabs). The JWT itself carries the expiry (7 days), so a
// stale token is rejected by the backend and cleared automatically on 401.
const STORAGE_KEY = "pomme_session_token";

let memoryToken: string | null = null;

function readPersistedToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePersistedToken(token: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (token) {
      window.localStorage.setItem(STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

export function getToken(): string | null {
  if (memoryToken === null) {
    memoryToken = readPersistedToken();
  }
  return memoryToken;
}

export function setToken(token: string): void {
  memoryToken = token;
  writePersistedToken(token);
}

export function clearToken(): void {
  memoryToken = null;
  writePersistedToken(null);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}
