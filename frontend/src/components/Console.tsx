// The Console: filters in the open, on the spin view itself — presets
// first-class, the slider demoted to fine-tuning. Replaces v1's hidden
// FiltersSheet bottom sheet. Same session state and semantics, new
// presentation: mobile mounts it under the spin bar, desktop puts it at the
// top of the rail.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, activatePool, listPools } from "../api";
import { PRESETS, useSession } from "../store";
import { activeFilterCount, activePreset } from "../logic";
import { S } from "../strings";
import { pinAwareMessage, withAdminPin } from "./AdminPin";
import { toast } from "./Toast";
import type { PoolItem, Stream } from "../types";

const RUNTIME_SCALE: Record<Stream, { min: number; max: number }> = {
  movie: { min: 40, max: 210 },
  tv: { min: 15, max: 90 },
};

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
const GENRES_COLLAPSED = 8;

export function Console({ pool }: { pool: PoolItem[] }) {
  const { stream, filters, setFilters, resetFilters, blind, setBlind } = useSession();
  const [genresExpanded, setGenresExpanded] = useState(false);
  const queryClient = useQueryClient();
  const poolsQuery = useQuery({ queryKey: ["pools"], queryFn: listPools });
  const streamPools = (poolsQuery.data ?? []).filter((p) => p.media_type === stream);
  const activePoolRow = streamPools.find((p) => !!p.active) ?? null;
  const [switching, setSwitching] = useState(false);

  async function switchPool(id: number) {
    if (id === activePoolRow?.id) return;
    setSwitching(true);
    try {
      await withAdminPin(() => activatePool(id));
      const name = streamPools.find((p) => p.id === id)?.name;
      if (name) toast(S.pools.switched(name));
      queryClient.invalidateQueries({ queryKey: ["pools"] });
      queryClient.invalidateQueries({ queryKey: ["pool"] });
      queryClient.invalidateQueries({ queryKey: ["state"] });
    } catch (e) {
      toast(e instanceof ApiError ? pinAwareMessage(e.detail) : S.common.writeFailed);
    } finally {
      setSwitching(false);
    }
  }
  const scale = RUNTIME_SCALE[stream];
  const preset = activePreset(filters, stream);
  const filterCount = activeFilterCount(filters);

  const genres = useMemo(
    () => Array.from(new Set(pool.flatMap((it) => it.genres))).sort(),
    [pool],
  );
  const shownGenres = genresExpanded ? genres : genres.slice(0, GENRES_COLLAPSED);

  const minVal = Math.min(Math.max(filters.runtimeMin ?? scale.min, scale.min), scale.max);
  const rawMax = filters.runtimeMax ?? Infinity;
  const maxVal = rawMax === Infinity ? scale.max : Math.min(Math.max(rawMax, scale.min), scale.max);
  const maxIsOpen = rawMax === Infinity || rawMax >= scale.max;

  const applyRange = (min: number, max: number) =>
    setFilters({ ...filters, runtimeMin: min, runtimeMax: max });

  const toggleGenre = (g: string) => {
    const has = filters.genres.includes(g);
    setFilters({
      ...filters,
      genres: has ? filters.genres.filter((x) => x !== g) : [...filters.genres, g],
    });
  };

  return (
    <section className="console" aria-label={S.filters.title}>
      {streamPools.length >= 2 && (
        <>
          <div className="console__label">{S.pools.watchingFrom}</div>
          <select
            className="decade-select"
            value={activePoolRow?.id ?? ""}
            disabled={switching}
            onChange={(e) => switchPool(Number(e.target.value))}
            aria-label={S.pools.watchingFrom}
          >
            {streamPools.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </>
      )}

      <div className="console__label">
        {S.filters.console.runtimeLabel}
        {filterCount > 0 && (
          <span className="console__count">{S.filters.console.activeCount(filterCount)}</span>
        )}
      </div>

      <div className="console__presets">
        <PresetButton
          label={S.filters.presets.schoolNight}
          range={S.filters.console.presetRange(
            PRESETS[stream].schoolNight[0], PRESETS[stream].schoolNight[1])}
          active={preset === "schoolNight"}
          onClick={() =>
            applyRange(PRESETS[stream].schoolNight[0], PRESETS[stream].schoolNight[1])}
        />
        <PresetButton
          label={S.filters.presets.committed}
          range={S.filters.console.presetRange(
            PRESETS[stream].committed[0], PRESETS[stream].committed[1])}
          active={preset === "committed"}
          onClick={() =>
            applyRange(PRESETS[stream].committed[0], PRESETS[stream].committed[1])}
        />
        <PresetButton
          label={S.filters.console.whatever}
          range={S.filters.console.whateverRange}
          active={preset === "whatever"}
          onClick={() => applyRange(0, Infinity)}
        />
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
      <div className="console__range-readout">
        {minVal}
        {maxIsOpen ? `–${scale.max}+` : `–${maxVal}`}
      </div>

      <div className="console__label">{S.filters.decade}</div>
      <div className="chip-row chip-row--wrap">
        <button
          type="button"
          className={"chip" + (filters.decade === null ? " chip--active" : "")}
          aria-pressed={filters.decade === null}
          onClick={() => setFilters({ ...filters, decade: null })}
        >
          {S.filters.anyDecade}
        </button>
        {DECADES.map((d) => (
          <button
            key={d}
            type="button"
            className={"chip" + (filters.decade === d ? " chip--active" : "")}
            aria-pressed={filters.decade === d}
            onClick={() => setFilters({ ...filters, decade: filters.decade === d ? null : d })}
          >
            {d}s
          </button>
        ))}
      </div>

      {genres.length > 0 && (
        <>
          <div className="console__label">{S.filters.genres}</div>
          <div className="chip-row chip-row--wrap">
            {shownGenres.map((g) => (
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
            {genres.length > GENRES_COLLAPSED && (
              <button
                type="button"
                className="chip"
                aria-expanded={genresExpanded}
                onClick={() => setGenresExpanded((e) => !e)}
              >
                {genresExpanded
                  ? S.filters.console.less
                  : S.filters.console.more(genres.length - GENRES_COLLAPSED)}
              </button>
            )}
          </div>
        </>
      )}

      <div className="console__toggles">
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
        <button type="button" className="console__reset" onClick={resetFilters}>
          {S.filters.reset}
        </button>
      </div>
    </section>
  );
}

function PresetButton({ label, range, active, onClick }: {
  label: string;
  range: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"console__preset" + (active ? " console__preset--active" : "")}
      aria-pressed={active}
      onClick={onClick}
    >
      <span>{label}</span>
      <small>{range}</small>
    </button>
  );
}
