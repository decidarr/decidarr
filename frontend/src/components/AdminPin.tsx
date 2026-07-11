// Admin-PIN-on-401 gate: any admin-only write can 401 with
// `admin_pin_required` the first time it's called in a session (or after a
// wrong PIN). `withAdminPin` wraps the call, prompts once via this sheet,
// stashes the PIN in api.ts's module-level `adminPin` (so it rides along on
// every subsequent request's X-Admin-Pin header — "once per session"), and
// retries exactly once. A wrong PIN surfaces as another 401 on the NEXT
// admin action, which re-prompts — there's no separate "forgot the PIN"
// flow needed.
import { useState } from "react";
import { create } from "zustand";

import { ApiError, setAdminPin } from "../api";
import { S } from "../strings";

interface AdminPinState {
  open: boolean;
  resolve: ((pin: string) => void) | null;
  reject: ((reason?: unknown) => void) | null;
}

const useAdminPinStore = create<AdminPinState>(() => ({
  open: false, resolve: null, reject: null,
}));

function requestAdminPin(): Promise<string> {
  return new Promise((resolve, reject) => {
    useAdminPinStore.setState({ open: true, resolve, reject });
  });
}

/** Runs `fn`; on a 401 `admin_pin_required`, prompts for the PIN, sets it,
 * and retries once. A cancelled prompt re-throws the original 401 so
 * callers' existing catch-blocks (toast on any failure) keep working
 * unchanged. */
export async function withAdminPin<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && e.detail === "admin_pin_required") {
      let pin: string;
      try {
        pin = await requestAdminPin();
      } catch {
        throw e;
      }
      setAdminPin(pin);
      return await fn();
    }
    throw e;
  }
}

/** Mount once near the app root (alongside <Toast/>) — invisible until
 * `withAdminPin` needs it. */
export function AdminPinPrompt() {
  const { open, resolve, reject } = useAdminPinStore();
  const [value, setValue] = useState("");

  if (!open) return null;

  function close() {
    setValue("");
    useAdminPinStore.setState({ open: false, resolve: null, reject: null });
  }

  function submit() {
    resolve?.(value);
    close();
  }

  function cancel() {
    reject?.();
    close();
  }

  return (
    <div className="sheet-overlay" role="presentation" onClick={cancel}>
      <div
        className="sheet confirm-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={S.settings.pinRequired}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sheet__title">{S.settings.pinRequired}</h2>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          className="decade-select admin-pin__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && value) submit(); }}
        />
        <div className="confirm-sheet__actions">
          <button type="button" className="btn-secondary" onClick={cancel}>
            {S.common.cancel}
          </button>
          <button type="button" className="btn-primary" disabled={!value} onClick={submit}>
            {S.common.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
