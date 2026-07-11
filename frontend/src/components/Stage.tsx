// Owns the spin state machine: idle -> spinning (winner already chosen)
// -> landed(winner). The winner is picked BEFORE the animation starts —
// the poster-shuffle is theater; assistive tech gets the result immediately
// via an aria-live region.
import { useEffect, useRef, useState } from "react";
import { Disc3, Swords } from "lucide-react";

import { eligibleItems, pickWinner, spinDurations } from "../logic";
import { postEvent } from "../api";
import { S } from "../strings";
import { useSession } from "../store";
import type { PoolItem } from "../types";

type Phase =
  | { kind: "idle" }
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "spinning"; winner: PoolItem; candidates: PoolItem[] }
  | { kind: "landed"; winner: PoolItem };

interface StageProps {
  pool: PoolItem[];
  seen: string[];
  /** True while the pool query for the current stream is still in flight. */
  poolLoading: boolean;
  /** True when the current stream has an active pool configured (so an empty
   * `pool` during load means "still fetching", not "genuinely empty"). */
  hasActivePool: boolean;
  onOpenSettings: () => void;
  onLaunchDuel?: () => void;
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
  onOpenSettings,
  onLaunchDuel,
}: StageProps) {
  const { playerId, stream, filters, resetFilters, setFilters } = useSession();
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

  function spin() {
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
    setPhase({ kind: "spinning", winner, candidates });
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
      spinDurations(reduced).spin,
    );
  }

  // Poster-shuffle: cycles the displayed poster through candidates with a
  // decreasing interval, overshoots one past the winner, then settles back.
  // Reduced motion skips the shuffle entirely — the winner shows immediately
  // and a CSS crossfade (var(--t-move), 300ms) does the rest.
  useEffect(() => {
    if (phase.kind !== "spinning") return;
    const { winner, candidates } = phase;

    if (reduced) {
      setDisplayItem(winner);
      return;
    }

    const total = spinDurations(reduced).spin;
    const settlePortion = Math.min(500, total * 0.2);
    const cyclePortion = total - settlePortion;
    const deck = candidates.length ? candidates : [winner];
    const overshootPool = deck.filter((i) => i.item_key !== winner.item_key);
    const overshoot = overshootPool.length
      ? overshootPool[Math.floor(Math.random() * overshootPool.length)]
      : winner;

    let elapsed = 0;
    let delay = 70; // starts fast, decreasing interval as the shuffle ramps
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      setDisplayItem(deck[Math.floor(Math.random() * deck.length)]);
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
    tick();

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

      <div className="stage__viewport">
        {phase.kind === "empty" && <EmptyWheel pool={pool} filters={filters}
          onResetFilters={fixResetFilters} onIncludeSeen={fixIncludeSeen}
          onOpenSettings={onOpenSettings} />}

        {phase.kind === "loading" && <LoadingPoster />}

        {phase.kind === "idle" && <IdlePoster />}

        {phase.kind === "spinning" && (
          <PosterBox item={displayItem} spinning />
        )}

        {phase.kind === "landed" && (
          // Placeholder for PickCard (Task 20) — the fixed Spin button
          // below already re-spins from this phase, so no inline re-spin
          // affordance is needed here.
          <div className="landed-card">
            <PosterBox item={phase.winner} />
            <h3 className="landed-card__title">{phase.winner.title}</h3>
            <p className="landed-card__meta">
              {phase.winner.year ?? ""}
              {phase.winner.runtime ? ` · ${phase.winner.runtime}m` : ""}
            </p>
          </div>
        )}
      </div>

      {phase.kind !== "empty" && (
        <div className="spin-bar">
          <button
            type="button"
            className="spin-button"
            onClick={spin}
            disabled={phase.kind === "spinning"}
          >
            <Disc3 size={20} aria-hidden="true" />
            {phase.kind === "spinning" ? S.spin.spinning : S.spin.button}
          </button>
          <button
            type="button"
            className="duel-button"
            onClick={() => onLaunchDuel?.()}
          >
            <Swords size={18} aria-hidden="true" />
            {S.spin.duel}
          </button>
        </div>
      )}
    </div>
  );
}

function IdlePoster() {
  return <div className="poster-box poster-box--placeholder" aria-hidden="true" />;
}

function LoadingPoster() {
  return <div className="poster-box skeleton" aria-label={S.emptyWheel.loading} />;
}

function PosterBox({ item, spinning }: { item: PoolItem | null; spinning?: boolean }) {
  return (
    <div className={"poster-box" + (spinning ? " poster-box--spinning" : "")}>
      {item?.poster ? (
        <img className="poster-box__img" src={item.poster} alt="" />
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
