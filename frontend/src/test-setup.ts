// Dependency-free in-memory localStorage for vitest's default node environment
// (no jsdom). Lets zustand's persist middleware write without emitting
// "storage is currently unavailable" warnings.
//
// zustand's persist default storage is `createJSONStorage(() => window.localStorage)`,
// so the shim must live on `window` (which node lacks entirely) — putting it only
// on `globalThis.localStorage` is not enough. We mirror it onto both.
//
// We install unconditionally rather than probing an existing `localStorage`:
// recent Node (v22+/v25) exposes a native Web Storage `localStorage` that only
// functions with a valid `--localstorage-file` flag, and merely *touching* it to
// test whether it works emits a node warning to stderr. A test run always wants
// deterministic in-memory storage anyway, so we just define our own and never
// read the native one.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}

const storage = new MemoryStorage() as unknown as Storage;

Object.defineProperty(globalThis, "localStorage", {
  value: storage, configurable: true, writable: true,
});

// zustand reads `window.localStorage`; node has no `window`, so provide a
// minimal one (kept intentionally tiny so nothing mistakes this for a real DOM).
const g = globalThis as { window?: { localStorage?: Storage } };
if (!g.window) {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage }, configurable: true, writable: true,
  });
} else {
  Object.defineProperty(g.window, "localStorage", {
    value: storage, configurable: true, writable: true,
  });
}
