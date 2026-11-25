// Session Bearer token held in memory only (never persisted to localStorage
// or sessionStorage). Next.js App Router SPA navigation keeps it alive across
// client route transitions.
let memoryToken: string | null = null;

export function getToken(): string | null {
  return memoryToken;
}

export function setToken(token: string): void {
  memoryToken = token;
}

export function clearToken(): void {
  memoryToken = null;
}

export function isAuthenticated(): boolean {
  return memoryToken !== null;
}
