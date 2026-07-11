// Toast host: a tiny Zustand slice exposing an imperative `toast()` function
// so any module (not just components) can raise a toast, plus a `<Toast/>`
// host component that renders the active queue. Slides up above the Spin
// button.
import { create } from "zustand";

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  /** Called when the toast expires WITHOUT the action being taken — the
   * veto-undo grace window (Task 20) fires its POST from here. */
  onExpire?: () => void;
  ttl?: number;
}

interface ToastItem {
  id: number;
  msg: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (t: ToastItem) => void;
  remove: (id: number) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (t) => set((s) => ({ toasts: [...s.toasts, t] })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

let nextId = 1;
// setTimeout handles live outside the store — they're not render state.
const pendingExpiry = new Map<number, number>();

export function toast(msg: string, opts: ToastOptions = {}): void {
  const { actionLabel, onAction, onExpire, ttl = 3000 } = opts;
  const id = nextId++;

  const wrappedAction = onAction
    ? () => {
        const handle = pendingExpiry.get(id);
        if (handle != null) {
          window.clearTimeout(handle);
          pendingExpiry.delete(id);
        }
        onAction();
        useToastStore.getState().remove(id);
      }
    : undefined;

  useToastStore.getState().add({ id, msg, actionLabel, onAction: wrappedAction });

  const handle = window.setTimeout(() => {
    pendingExpiry.delete(id);
    onExpire?.();
    useToastStore.getState().remove(id);
  }, ttl);
  pendingExpiry.set(id, handle);
}

/** Toast host — mount once near the root, above the Spin button. */
export function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span className="toast__msg">{t.msg}</span>
          {t.actionLabel && (
            <button type="button" className="toast__action" onClick={t.onAction}>
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
