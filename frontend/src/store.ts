import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Filters, Stream } from "./types";

export const DEFAULT_FILTERS: Filters = {
  runtimeMin: 0, runtimeMax: Infinity, genres: [], decade: null,
  includeSeen: false,
};

export const PRESETS = {
  movie: { schoolNight: [40, 110], committed: [110, 210] },
  tv: { schoolNight: [15, 35], committed: [35, 90] },
} as const;

interface Session {
  playerId: number | null;
  stream: Stream;
  blind: boolean;
  filters: Filters;
  setPlayer: (id: number | null) => void;
  setStream: (s: Stream) => void;
  setBlind: (b: boolean) => void;
  setFilters: (f: Filters) => void;
  resetFilters: () => void;
}

export const useSession = create<Session>()(persist(
  (set) => ({
    playerId: null, stream: "movie", blind: false,
    filters: { ...DEFAULT_FILTERS },
    setPlayer: (playerId) => set({ playerId }),
    setStream: (stream) => set({ stream }),
    setBlind: (blind) => set({ blind }),
    setFilters: (filters) => set({ filters }),
    resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),
  }),
  { name: "decidarr" },
));
