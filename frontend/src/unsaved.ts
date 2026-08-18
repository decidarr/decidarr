// Unsaved-changes navigation guard (v1.12). A form with uncommitted edits
// (today: the Connections cards) registers itself here; every navigation
// that would unmount it asks permission via requestNav. Clean state
// navigates instantly — the guard is invisible until it matters.
import { create } from "zustand";

interface UnsavedState {
  dirty: boolean;
  /** Saves everything dirty; resolves false to veto the navigation
   * (failed write, cancelled PIN) — the form stays up with its state. */
  save: (() => Promise<boolean>) | null;
  /** The deferred navigation awaiting a Save/Discard/Stay decision;
   * non-null is what tells the app to render the prompt. */
  pendingNav: (() => void) | null;
  setGuard: (dirty: boolean, save: (() => Promise<boolean>) | null) => void;
  clearGuard: () => void;
  requestNav: (nav: () => void) => void;
  resolveStay: () => void;
  resolveDiscard: () => void;
  resolveSave: () => Promise<void>;
}

export const useUnsaved = create<UnsavedState>((set, get) => ({
  dirty: false,
  save: null,
  pendingNav: null,

  setGuard: (dirty, save) => set({ dirty, save }),
  clearGuard: () => set({ dirty: false, save: null }),

  requestNav: (nav) => {
    if (get().dirty) set({ pendingNav: nav });
    else nav();
  },

  resolveStay: () => set({ pendingNav: null }),

  resolveDiscard: () => {
    const nav = get().pendingNav;
    set({ pendingNav: null, dirty: false, save: null });
    nav?.();
  },

  resolveSave: async () => {
    const { save, pendingNav } = get();
    const ok = save ? await save() : true;
    if (!ok) {
      // stay put — the form surfaces its own error/PIN toast
      set({ pendingNav: null });
      return;
    }
    set({ pendingNav: null, dirty: false, save: null });
    pendingNav?.();
  },
}));
