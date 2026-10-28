import { STAFF_KEY_STORAGE } from "@needgrid/shared";

// The staff passcode lives in sessionStorage only (gone when the tab closes). Storage can throw
// (privacy modes, disabled storage), which is treated as "no key".

export function getStaffKey(): string | null {
  try {
    return sessionStorage.getItem(STAFF_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setStaffKey(key: string): void {
  try {
    sessionStorage.setItem(STAFF_KEY_STORAGE, key);
  } catch {
    // Without storage the user simply has to sign in again on the next request.
  }
}

export function clearStaffKey(): void {
  try {
    sessionStorage.removeItem(STAFF_KEY_STORAGE);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
