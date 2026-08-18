// Owns the spin state machine: idle -> spinning (winner already chosen)
// -> landed(winner). The winner is picked BEFORE the animation starts —
// the poster-shuffle is theater; assistive tech gets the result immediately
// via an aria-live region.
import { useEffect, useMemo, useRef, useState } from "react";
import { Disc3, SlidersHorizontal } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { activeFilterCount, applyPresetRange, activePreset, eligibleItems, fanPosters, heroCountLine, heroReadyLine, pickWinner, posterUrl, shuffleReel, spinDurations } from "../logic";
import type { PresetKey } from "../logic";
import { usePoolSwitcher } from "../usePoolSwitcher";
import { TonightCard } from "./TonightCard";
import { postEvent } from "../api";
import { PickCard } from "./PickCard";
import { ReelMark } from "./ReelMark";
import { toast } from "./Toast";
import { S } from "../strings";
import { useSession } from "../store";
import type { CurrentPick, PoolItem } from "../types";

type Phase =
  | { kind: "idle" }
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "spinning"; winner: PoolItem; candidates: PoolItem[]; respin?: boolean }
  | { kind: "landed"; winner: PoolItem };

interface StageProps {
  pool: PoolItem[];
  seen: string[];
  /** True while the pool query for the current stream is still in flight. */
  poolLoading: boolean;
  /** True when the current stream has an active pool configured (so an empty
   * `pool` during load means "still fetching", not "genuinely empty"). */
  hasActivePool: boolean;
  /** Active pool's display name for the hero kicker (null: no active pool). */
  poolName: string | null;
  /** Tonight's committed pick key for the current stream (null: none) — the
   * hero's slim variant subtracts it from the count. Mobile passes this. */
  pickKey?: string | null;
  /** Tonight's pick, desktop zen column only: Stage renders it ON the stage
   * in the idle phase and shows the replace chip mid-spin. Mobile passes
   * null and keeps its above-stage TonightCard. */
  pick?: CurrentPick | null;
  pickPoolItem?: PoolItem | null;
  /** Opens the desktop filters sheet (ZenStrip's Filters button). */
  onOpenFilters?: () => void;
  onOpenSettings: () => void;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function Stage({
  pool,
  seen,
  poolLoading,
  hasActivePool,
  poolName,
  pickKey = null,
  pick = null,
  pickPoolItem = null,
  onOpenFilters,
  onOpenSettings,
}: StageProps) {
  // Desktop passes the whole pick; mobile just its key. One derived truth.
  const effectivePickKey = pick?.item_key ?? pickKey ?? null;
  const { playerId, stream, filters, resetFilters, setFilters } = useSession();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [live, setLive] = useState("");
  const [displayItem, setDisplayItem] = useState<PoolItem | null>(null);
  const reduced = useRef(reducedMotion()).current;
  const shuffleTimer = useRef<number | null>(null);
  const landTimer = useRef<number | null>(null);

  const clearTimers = () => {
    if (shuffleTimer.current != null) window.clearTimeout(shuffleTimer.current);
    if (landTimer.current != null) window.clearTimeout(landTimer.current);
    shuffleTimer.current = null;
    landTimer.current = null;
  };

  // Clear any in-flight spin timers on unmount so setPhase never fires on a
  // dead component.
  useEffect(() => clearTimers, []);

  // "Movies or TV, never mixed": switching streams must not leave a stale
  // pick (or a mid-spin animation) on the stage. Reset to idle and kill any
  // in-flight timers whenever the stream changes.
  useEffect(() => {
    clearTimers();
    setPhase({ kind: "idle" });
    setLive("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  function spin(opts?: { respin?: boolean }) {
    const candidates = eligibleItems(pool, filters, seen);
    const winner = pickWinner(candidates);
    if (!winner) {
      // Distinguish "pool still fetching" from "pool genuinely has nothing
      // eligible" — a Spin tap during the load window shows a skeleton, not
      // the empty-wheel dead-end.
      setPhase(poolLoading && hasActivePool ? { kind: "loading" } : { kind: "empty" });
      return;
    }
    clearTimers();
    setPhase({ kind: "spinning", winner, candidates, respin: opts?.respin });
    setLive(S.spinResult(winner.title)); // aria-live gets it immediately
    if (playerId != null) {
      postEvent({
        player: playerId,
        media_type: stream,
        item_key: winner.item_key,
        title: winner.title,
        year: winner.year,
        action: "spun",
      }).catch(() => {
        // Best-effort telemetry — a failed "spun" log must never block the
        // spin itself from landing.
      });
    }
    landTimer.current = window.setTimeout(
      () => setPhase({ kind: "landed", winner }),
      opts?.respin ? spinDurations(reduced).respin : spinDurations(reduced).spin,
    );
  }

  // Veto (grace expiry) and Seen-it both invalidate the current landed pick
  // and want a fresh one immediately — the design spec's shortened re-spin beat.
  const respin = () => spin({ respin: true });

  // Poster-shuffle: cycles the displayed poster through candidates with a
  // decreasing interval, overshoots one past the winner, then settles back.
  // Reduced motion skips the shuffle entirely — the winner shows immediately
  // and a CSS crossfade (var(--t-move), 300ms) does the rest.
  useEffect(() => {
    if (phase.kind !== "spinning") return;
    const { winner, candidates, respin: isRespin } = phase;

    if (reduced) {
      setDisplayItem(winner);
      return;
    }

    const total = isRespin ? spinDurations(reduced).respin : spinDurations(reduced).spin;
    const settlePortion = Math.min(500, total * 0.2);
    const cyclePortion = total - settlePortion;
    const deck = candidates.length ? candidates : [winner];
    // A bounded reel instead of random draws from the whole deck: fourteen
    // posters can be preloaded before the first frame, three hundred can't —
    // fetching+decoding a cold w500 every 40-70ms was the stutter.
    const reel = shuffleReel(deck);
    const overshootPool = reel.filter((i) => i.item_key !== winner.item_key);
    const overshoot = overshootPool.length
      ? overshootPool[Math.floor(Math.random() * overshootPool.length)]
      : winner;

    let elapsed = 0;
    let delay = 70; // starts fast, decreasing interval as the shuffle ramps
    let step = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      setDisplayItem(reel[step++ % reel.length]);
      navigator.vibrate?.(10);
      elapsed += delay;
      delay = Math.max(40, delay - 6);
      if (elapsed < cyclePortion) {
        shuffleTimer.current = window.setTimeout(tick, delay);
      } else {
        // overshoot one past the winner, then settle
        setDisplayItem(overshoot);
        navigator.vibrate?.(10);
        shuffleTimer.current = window.setTimeout(() => {
          setDisplayItem(winner);
        }, settlePortion / 2);
      }
    };

    // Warm every reel poster (plus the landing pair) and hold the curtain
    // for at most 300ms while they decode — cached art starts instantly.
    const urls = [...new Set(
      [...reel, overshoot, winner]
        .map((i) => posterUrl(i.poster))
        .filter((u): u is string => u !== null),
    )];
    const warmups = urls.map((u) => {
      const img = new Image();
      img.src = u;
      return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    });
    Promise.race([
      Promise.allSettled(warmups),
      new Promise((r) => { shuffleTimer.current = window.setTimeout(r, 300); }),
    ]).then(() => {
      if (!cancelled) tick();
    });

    return () => {
      cancelled = true;
      if (shuffleTimer.current != null) window.clearTimeout(shuffleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduced]);

  // If the player tapped Spin while the pool was still fetching, honor that
  // intent: once the data lands, run the spin they asked for.
  useEffect(() => {
    if (phase.kind === "loading" && !poolLoading) spin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, poolLoading]);

  const fixResetFilters = () => {
    resetFilters();
    setPhase({ kind: "idle" });
  };
  const fixIncludeSeen = () => {
    setFilters({ ...filters, includeSeen: true });
    setPhase({ kind: "idle" });
  };

  return (
    <div className="stage">
      <div className="visually-hidden" aria-live="polite">
        {live}
      </div>

      {/* Mid-spin over a committed pick: name the stakes (zen replace flow). */}
      {pick && phase.kind !== "idle" && phase.kind !== "empty" && (
        <span className="stage__replacing">{S.watch.replacing(pick.title)}</span>
      )}

      <div className="stage__viewport">
        {phase.kind === "empty" && <EmptyWheel pool={pool} filters={filters}
          onResetFilters={fixResetFilters} onIncludeSeen={fixIncludeSeen}
          onOpenSettings={onOpenSettings} />}

        {phase.kind === "loading" && <LoadingPoster />}

        {phase.kind === "idle" && (
          poolLoading && hasActivePool ? (
            <LoadingPoster />
          ) : pick ? (
            <TonightCard
              key={pick.item_key}
              pick={pick}
              variant="stage"
              poolItem={pickPoolItem}
            />
          ) : (
            <IdleHero
              pool={pool}
              seen={seen}
              poolName={poolName}
              hasActivePool={hasActivePool}
              pickKey={effectivePickKey}
            />
          )
        )}

        {phase.kind === "spinning" && (
          <PosterBox item={displayItem} spinning />
        )}

        {phase.kind === "landed" && (
          <PickCard
            key={phase.winner.item_key}
            item={phase.winner}
            onVetoed={(remaining) => {
              toast(S.veto.used(remaining));
              respin();
            }}
            onSeenIt={respin}
            onCommitted={() => {
              // Committing hands the pick off to TonightCard (which mounts
              // above the Stage from current_picks). The Stage must return
              // to the idle wheel *beneath* it — otherwise both cards show
              // the same item and, on the summon path, mount two Progress
              // pollers for the same download. Go through clearTimers so no
              // land/shuffle timer leaks (same discipline as stream-switch).
              clearTimers();
              setPhase({ kind: "idle" });
              setLive("");
              queryClient.invalidateQueries({ queryKey: ["state"] });
            }}
          />
        )}
      </div>

      {phase.kind !== "empty" && (
        <div className="spin-bar">
          <button
            type="button"
            className="spin-button"
            onClick={() => spin()}
            disabled={phase.kind === "spinning"}
          >
            <Disc3 size={20} aria-hidden="true" />
            {phase.kind === "spinning" ? S.spin.spinning : S.spin.button}
          </button>
        </div>
      )}

      {phase.kind !== "empty" && (
        <ZenStrip
          filtersActive={activeFilterCount(filters)}
          spinning={phase.kind === "spinning"}
          onSpin={() => spin()}
          onOpenFilters={onOpenFilters}
        />
      )}
    </div>
  );
}

/** The zen column's one-row control surface (desktop only — CSS keeps it
 * hidden outside `.zen`, and the classic spin bar hidden inside it): list,
 * length, the filters sheet, and Spin. */
function ZenStrip({
  filtersActive, spinning, onSpin, onOpenFilters,
}: {
  filtersActive: number;
  spinning: boolean;
  onSpin: () => void;
  onOpenFilters?: () => void;
}) {
  const { stream, filters, setFilters } = useSession();
  const { streamPools, activePool, switching, switchPool } = usePoolSwitcher();
  const preset = activePreset(filters, stream);

  return (
    <div className="zen-strip">
      {streamPools.length >= 2 && (
        <label className="zen-strip__field">
          <span className="zen-strip__label">{S.pools.watchingFrom}</span>
          <select
            className="decade-select zen-strip__select"
            value={activePool?.id ?? ""}
            disabled={switching}
            onChange={(e) => switchPool(Number(e.target.value))}
          >
            {streamPools.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="zen-strip__field">
        <span className="zen-strip__label">{S.filters.runtime}</span>
        <select
          className="decade-select zen-strip__select"
          value={preset ?? "custom"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "custom") return;
            setFilters({ ...filters, ...applyPresetRange(v as PresetKey, stream) });
          }}
        >
          <option value="schoolNight">{S.filters.presets.schoolNight}</option>
          <option value="committed">{S.filters.presets.committed}</option>
          <option value="whatever">{S.filters.console.whatever}</option>
          {preset === null && <option value="custom">{S.filters.console.custom}</option>}
        </select>
      </label>
      <button type="button" className="btn-secondary zen-strip__filters" onClick={onOpenFilters}>
        <SlidersHorizontal size={14} aria-hidden="true" />
        {S.filters.title}
        {filtersActive > 0 ? S.filters.console.activeCount(filtersActive) : ""}
      </button>
      <button
        type="button"
        className="spin-button zen-strip__spin"
        onClick={onSpin}
        disabled={spinning}
      >
        <Disc3 size={18} aria-hidden="true" />
        {spinning ? S.spin.spinning : S.spin.button}
      </button>
    </div>
  );
}

/** The landing hero: what greets a player before anything is spun. Full
 * welcome (kicker + invitation + live count) when nothing is picked;
 * a slim ready-line under a committed TonightCard; the pool-missing nudge
 * when no pool is active. The count comes from the same eligibleItems()
 * call spin() uses, so the number and the wheel can never disagree. */
function IdleHero({ pool, seen, poolName, hasActivePool, pickKey }: {
  pool: PoolItem[];
  seen: string[];
  poolName: string | null;
  hasActivePool: boolean;
  pickKey: string | null;
}) {
  const { stream, filters } = useSession();
  const eligible = eligibleItems(pool, filters, seen);
  const n = eligible.length;
  const filtersActive = activeFilterCount(filters) > 0;
  const hasPick = pickKey != null;
  // A fresh handful per pool arrival — desktop set dressing (CSS hides it
  // below the theater breakpoint). eslint: sampling is deliberately keyed
  // to the pool, not every filter tweak.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fan = useMemo(() => fanPosters(eligible), [pool]);

  if (hasPick) {
    const rest = eligible.some((i) => i.item_key === pickKey) ? n - 1 : n;
    return (
      <div className="idle-hero idle-hero--slim">
        <p className="idle-hero__count">{heroReadyLine(rest)}</p>
      </div>
    );
  }
  return (
    <div className="idle-hero">
      <ReelMark size={84} className="idle-hero__mark" />
      {fan.length >= 2 && (
        <div className="idle-hero__fan" aria-hidden="true">
          {fan.map((src, i) => (
            <img
              key={src}
              className={`idle-hero__fan-poster idle-hero__fan-poster--${i}`}
              src={src}
              alt=""
            />
          ))}
        </div>
      )}
      <span className="idle-hero__kicker">
        {poolName ? `${poolName} · ${S.hero.kicker}` : S.hero.kicker}
      </span>
      <p className="idle-hero__invite">{S.hero.invite}</p>
      <p className="idle-hero__count">
        {hasActivePool
          ? heroCountLine(n, stream, filtersActive, filters.includeSeen)
          : S.emptyWheel.noPool}
      </p>
    </div>
  );
}

function LoadingPoster() {
  return <div className="poster-box skeleton" aria-label={S.emptyWheel.loading} />;
}

function PosterBox({ item, spinning }: { item: PoolItem | null; spinning?: boolean }) {
  const src = posterUrl(item?.poster);
  return (
    <div className={"poster-box" + (spinning ? " poster-box--spinning" : "")}>
      {src ? (
        <img className="poster-box__img" src={src} alt="" />
      ) : (
        <div className="poster-box__fallback" />
      )}
      <div className="poster-box__scrim" />
    </div>
  );
}

function EmptyWheel({
  pool,
  filters,
  onResetFilters,
  onIncludeSeen,
  onOpenSettings,
}: {
  pool: PoolItem[];
  filters: ReturnType<typeof useSession.getState>["filters"];
  onResetFilters: () => void;
  onIncludeSeen: () => void;
  onOpenSettings: () => void;
}) {
  const message = pool.length === 0
    ? S.emptyWheel.poolEmpty
    : !filters.includeSeen
      ? S.emptyWheel.allSeen
      : S.emptyWheel.poolEmpty;

  return (
    <div className="empty-wheel">
      <h3 className="empty-wheel__title">{S.emptyWheel.title}</h3>
      <p className="empty-wheel__body">{message}</p>
      <div className="empty-wheel__fixes">
        <button type="button" className="btn-secondary" onClick={onResetFilters}>
          {S.emptyWheel.fixes.resetFilters}
        </button>
        {!filters.includeSeen && (
          <button type="button" className="btn-secondary" onClick={onIncludeSeen}>
            {S.emptyWheel.fixes.includeSeen}
          </button>
        )}
        <button type="button" className="btn-link" onClick={onOpenSettings}>
          {S.emptyWheel.fixes.openSettings}
        </button>
      </div>
    </div>
  );
}
