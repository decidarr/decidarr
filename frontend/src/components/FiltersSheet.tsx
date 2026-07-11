// Bottom sheet: dual-handle runtime range, School Night / Committed presets,
// genre chips (union of genres in the current pool), decade select,
// include-seen and blind-mode toggles, Reset.
import { useMemo } from "react";

import { PRESETS, useSession } from "../store";
import { S } from "../strings";
import type { PoolItem, Stream } from "../types";

interface FiltersSheetProps {
  stream: Stream;
  pool: PoolItem[];
  onClose: () => void;
}

const RUNTIME_SCALE: Record<Stream, { min: number; max: number }> = {
  movie: { min: 40, max: 210 },
  tv: { min: 15, max: 90 },
};

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

export function FiltersSheet({ stream, pool, onClose }: FiltersSheetProps) {
  const { filters, setFilters, resetFilters, blind, setBlind } = useSession();
  const scale = RUNTIME_SCALE[stream];

  const genres = useMemo(
    () => Array.from(new Set(pool.flatMap((it) => it.genres))).sort(),
    [pool],
  );

  const minVal = Math.min(Math.max(filters.runtimeMin ?? scale.min, scale.min), scale.max);
  const rawMax = filters.runtimeMax ?? Infinity;
  const maxVal = rawMax === Infinity ? scale.max : Math.min(Math.max(rawMax, scale.min), scale.max);
  const maxIsOpen = rawMax === Infinity || rawMax >= scale.max;

  const applyPreset = (range: readonly [number, number]) => {
    setFilters({ ...filters, runtimeMin: range[0], runtimeMax: range[1] });
  };

  const toggleGenre = (g: string) => {
    const has = filters.genres.includes(g);
    setFilters({
      ...filters,
      genres: has ? filters.genres.filter((x) => x !== g) : [...filters.genres, g],
    });
  };

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="sheet filters-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={S.filters.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__header">
          <h2 className="sheet__title">{S.filters.title}</h2>
          <button type="button" className="sheet__close" onClick={onClose}>
            {S.filters.done}
          </button>
        </div>

        <section className="filters-section">
          <div className="filters-section__label">
            {S.filters.runtime}: {minVal}
            {maxIsOpen ? `–${scale.max}+` : `–${maxVal}`}
          </div>
          <div className="range-dual">
            <input
              type="range"
              className="range-dual__input"
              min={scale.min}
              max={scale.max}
              value={minVal}
              onChange={(e) => {
                const v = Math.min(Number(e.target.value), maxVal);
                setFilters({ ...filters, runtimeMin: v });
              }}
              aria-label={S.filters.runtimeMinLabel}
            />
            <input
              type="range"
              className="range-dual__input"
              min={scale.min}
              max={scale.max}
              value={maxVal}
              onChange={(e) => {
                const raw = Number(e.target.value);
                const v = Math.max(raw, minVal);
                setFilters({ ...filters, runtimeMax: v >= scale.max ? Infinity : v });
              }}
              aria-label={S.filters.runtimeMaxLabel}
            />
          </div>
          <div className="chip-row">
            <button type="button" className="chip" onClick={() => applyPreset(PRESETS[stream].schoolNight)}>
              {S.filters.presets.schoolNight}
            </button>
            <button type="button" className="chip" onClick={() => applyPreset(PRESETS[stream].committed)}>
              {S.filters.presets.committed}
            </button>
          </div>
        </section>

        {genres.length > 0 && (
          <section className="filters-section">
            <div className="filters-section__label">{S.filters.genres}</div>
            <div className="chip-row chip-row--wrap">
              {genres.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={filters.genres.includes(g)}
                  className={"chip" + (filters.genres.includes(g) ? " chip--active" : "")}
                  onClick={() => toggleGenre(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="filters-section">
          <div className="filters-section__label">{S.filters.decade}</div>
          <select
            className="decade-select"
            value={filters.decade ?? ""}
            onChange={(e) =>
              setFilters({ ...filters, decade: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">{S.filters.anyDecade}</option>
            {DECADES.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
        </section>

        <section className="filters-section filters-section--row">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={filters.includeSeen}
              onChange={(e) => setFilters({ ...filters, includeSeen: e.target.checked })}
            />
            {S.filters.includeSeen}
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={blind}
              onChange={(e) => setBlind(e.target.checked)}
            />
            {S.filters.blindMode}
          </label>
        </section>

        <button type="button" className="filters-reset" onClick={resetFilters}>
          {S.filters.reset}
        </button>
      </div>
    </div>
  );
}
