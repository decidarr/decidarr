// Pass-the-phone duel: two players spin their own slot, crown a winner
// under whichever card they like (never tap-the-poster — that collides
// with the tap-for-details gesture elsewhere), or let Fate flip a coin.
// Duel state is entirely client-local in v1 — realtime multi-device
// duels are a v2 idea (see the design spec's parking lot). Vetoes are
// disabled inside a duel: the duel IS the negotiation.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Crown, Eye, RotateCcw, Shuffle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { ApiError, duelWin, getState, postEvent } from "../api";
import { defaultDuelOpponent, duelCandidates, formatMetaLine, pickWinner, spinDurations } from "../logic";
import { S } from "../strings";
import { useSession } from "../store";
import { toast } from "./Toast";
import { ConfirmSheet } from "./PickCard";
import type { Player, PoolItem, Stream } from "../types";

export interface DuelProps {
  players: Player[];
  pool: PoolItem[];
  seen: string[];
  /** Fires once the crowned pick is committed server-side — the caller
   * closes the duel and lets the normal pick flow (TonightCard) take it
   * from here, same as PickCard's onCommitted. */
  onDone: (item: PoolItem, player: Player) => void;
  onClose: () => void;
}

interface SlotState {
  item: PoolItem | null;
  spinning: boolean;
}

const EMPTY_SLOT: SlotState = { item: null, spinning: false };
type SlotPair = [SlotState, SlotState];
type IdPair = [number | null, number | null];

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function Duel({ players, pool, seen, onDone, onClose }: DuelProps) {
  const { playerId, stream, filters } = useSession();
  const stateQuery = useQuery({ queryKey: ["state"], queryFn: getState });
  const reduced = useRef(reducedMotion()).current;

  const needsPicker = players.length >= 3;
  const [phase, setPhase] = useState<"picker" | "battle">(needsPicker ? "picker" : "battle");

  const [duelistIds, setDuelistIds] = useState<IdPair>(() => {
    if (players.length < 2) return [playerId, null];
    // defaultDuelOpponent already validates any history hit against the
    // active `players` list and falls back to the first other active
    // player, so no extra guard is needed here.
    const opponent = defaultDuelOpponent(players, playerId, stateQuery.data?.history ?? []);
    return [playerId, opponent];
  });

  function setDuelist(slot: 0 | 1, id: number) {
    setDuelistIds((ids) => {
      const other = (1 - slot) as 0 | 1;
      const next: IdPair = [...ids];
      if (ids[other] === id) next[other] = ids[slot]; // swap on collision
      next[slot] = id;
      return next;
    });
  }

  const duelists: [Player | null, Player | null] = [
    players.find((p) => p.id === duelistIds[0]) ?? null,
    players.find((p) => p.id === duelistIds[1]) ?? null,
  ];

  const [slots, setSlotsState] = useState<SlotPair>([EMPTY_SLOT, EMPTY_SLOT]);
  const slotsRef = useRef<SlotPair>(slots);
  const duelistsRef = useRef(duelists);
  duelistsRef.current = duelists;
  function setSlots(updater: (s: SlotPair) => SlotPair) {
    slotsRef.current = updater(slotsRef.current);
    setSlotsState(slotsRef.current);
  }
  function replaceSlot(s: SlotPair, slot: 0 | 1, next: SlotState): SlotPair {
    const copy = [...s] as SlotPair;
    copy[slot] = next;
    return copy;
  }

  const [live, setLive] = useState("");
  const [flipping, setFlipping] = useState(false);
  const [crowning, setCrowning] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<0 | 1 | null>(null);
  const timers = useRef<number[]>([]);
  const track = (id: number) => { timers.current.push(id); return id; };

  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  function spinSlot(slot: 0 | 1) {
    const other = slotsRef.current[1 - slot]?.item?.item_key ?? null;
    const candidates = duelCandidates(pool, filters, seen, other);
    const winner = pickWinner(candidates);
    if (!winner) {
      toast(S.emptyWheel.poolEmpty);
      return;
    }
    setSlots((s) => replaceSlot(s, slot, { item: winner, spinning: true }));
    setLive(S.spinResult(winner.title));
    const duelist = duelistsRef.current[slot];
    if (duelist) {
      postEvent({
        player: duelist.id, media_type: stream, item_key: winner.item_key,
        title: winner.title, year: winner.year, action: "spun",
      }).catch(() => {
        // Best-effort telemetry — must never block the spin from landing.
      });
    }
    track(window.setTimeout(() => {
      setSlots((s) => replaceSlot(s, slot, { item: winner, spinning: false }));
    }, spinDurations(reduced).respin));
  }

  function spinBoth() {
    setFlipping(false);
    spinSlot(0);
    spinSlot(1);
  }

  // Kick off the first duel once both duelists are settled: immediately on
  // mount for the 2-player case, or the moment the picker hands off to
  // battle for 3+ players.
  useEffect(() => {
    if (phase === "battle") spinBoth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function seenIt(slot: 0 | 1) {
    const s = slotsRef.current[slot];
    const duelist = duelistsRef.current[slot];
    if (!s.item || !duelist) return;
    try {
      await postEvent({
        player: duelist.id, media_type: stream, item_key: s.item.item_key,
        title: s.item.title, year: s.item.year, action: "seen",
      });
      toast(S.duel.seenItRespin);
      spinSlot(slot);
    } catch {
      toast(S.common.writeFailed);
    }
  }

  async function crown(slot: 0 | 1, replace = false) {
    const s = slotsRef.current[slot];
    const duelist = duelistsRef.current[slot];
    if (!s.item || !duelist || crowning) return;
    setCrowning(true);
    try {
      await duelWin({
        player: duelist.id, media_type: stream, item_key: s.item.item_key,
        title: s.item.title, year: s.item.year, tmdb_id: s.item.tmdb_id, replace,
      });
      setPendingReplace(null);
      toast(`${duelist.name} ${S.duel.crownWinner}`);
      onDone(s.item, duelist);
    } catch (e) {
      if (e instanceof ApiError && e.detail === "pending_pick") {
        setPendingReplace(slot);
      } else {
        toast(S.common.writeFailed);
      }
    } finally {
      setCrowning(false);
    }
  }

  function fateDecide() {
    if (flipping || crowning) return;
    if (!slots[0].item || !slots[1].item || slots[0].spinning || slots[1].spinning) return;
    setFlipping(true);
    track(window.setTimeout(() => {
      setFlipping(false);
      const winnerSlot: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
      crown(winnerSlot);
    }, spinDurations(reduced).fate));
  }

  if (players.length < 2) {
    return (
      <DuelShell onClose={onClose}>
        <p className="pick-card__hint">{S.duel.needTwoPlayers}</p>
      </DuelShell>
    );
  }

  const busy = flipping || crowning || slots[0].spinning || slots[1].spinning;

  return (
    <DuelShell onClose={onClose}>
      {phase === "picker" && (
        <div className="duel-picker">
          <p className="duel-picker__label">{S.duel.pickerTitle}</p>
          <div className="duel-picker__row">
            <select
              className="decade-select"
              value={duelistIds[0] ?? ""}
              onChange={(e) => setDuelist(0, Number(e.target.value))}
            >
              {players.map((p) => (
                <option key={p.id} value={p.id}>{p.emoji ? `${p.emoji} ${p.name}` : p.name}</option>
              ))}
            </select>
            <span className="duel-vs" aria-hidden="true">{S.duel.vs}</span>
            <select
              className="decade-select"
              value={duelistIds[1] ?? ""}
              onChange={(e) => setDuelist(1, Number(e.target.value))}
            >
              {players.map((p) => (
                <option key={p.id} value={p.id}>{p.emoji ? `${p.emoji} ${p.name}` : p.name}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={duelistIds[0] == null || duelistIds[1] == null || duelistIds[0] === duelistIds[1]}
            onClick={() => setPhase("battle")}
          >
            {S.duel.start}
          </button>
        </div>
      )}

      {phase === "battle" && (
        <div className="duel-battle">
          <div className="visually-hidden" aria-live="polite">{live}</div>
          <div className="duel-slots">
            <DuelSlot
              player={duelists[0]} state={slots[0]} stream={stream}
              onSeenIt={() => seenIt(0)} onCrown={() => crown(0)} busy={busy}
            />
            <span className="duel-vs" aria-hidden="true">{S.duel.vs}</span>
            <DuelSlot
              player={duelists[1]} state={slots[1]} stream={stream}
              onSeenIt={() => seenIt(1)} onCrown={() => crown(1)} busy={busy}
            />
          </div>

          <div className="duel-fate">
            <button
              type="button"
              className={"duel-fate__button" + (flipping ? " duel-fate__button--flipping" : "")}
              onClick={fateDecide}
              disabled={busy}
            >
              <Shuffle size={18} aria-hidden="true" />
              {flipping ? S.duel.spinning : S.duel.fate}
            </button>
            <button type="button" className="duel-rematch" onClick={spinBoth} disabled={busy}>
              <RotateCcw size={16} aria-hidden="true" />
              {S.duel.rematch}
            </button>
          </div>
        </div>
      )}

      {pendingReplace != null && (
        <ConfirmSheet
          title={S.watch.pendingConflictTitle}
          body={S.watch.pendingConflict}
          confirmLabel={S.watch.replace}
          onConfirm={() => crown(pendingReplace, true)}
          onCancel={() => setPendingReplace(null)}
        />
      )}
    </DuelShell>
  );
}

function DuelShell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="sheet duel-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={S.duel.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__header">
          <h2 className="sheet__title">{S.duel.title}</h2>
          <button type="button" className="sheet__close" onClick={onClose}>
            {S.common.close}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DuelSlot({
  player,
  state,
  stream,
  onSeenIt,
  onCrown,
  busy,
}: {
  player: Player | null;
  state: SlotState;
  stream: Stream;
  onSeenIt: () => void;
  onCrown: () => void;
  busy: boolean;
}) {
  const item = state.item;
  const disabled = !item || !player || state.spinning || busy;
  return (
    <div className="duel-slot">
      {player && (
        <span className="duel-slot__name">
          {player.emoji ? `${player.emoji} ${player.name}` : player.name}
        </span>
      )}

      <div className={"poster-box" + (state.spinning ? " poster-box--spinning" : "")}>
        {item?.poster ? (
          <img className="poster-box__img" src={item.poster} alt="" />
        ) : (
          <div className="poster-box__fallback" />
        )}
        <div className="poster-box__scrim" />
      </div>

      {item && (
        <>
          <h4 className="duel-slot__title">{item.title}</h4>
          <p className="duel-slot__meta">{formatMetaLine(item, stream)}</p>
        </>
      )}

      <div className="duel-slot__actions">
        <button type="button" className="btn-secondary" onClick={onSeenIt} disabled={disabled}>
          <Eye size={16} aria-hidden="true" />
          {S.watch.seenIt}
        </button>
        <button type="button" className="btn-primary" onClick={onCrown} disabled={disabled}>
          <Crown size={18} aria-hidden="true" />
          {S.duel.proceedToSummon}
        </button>
      </div>
    </div>
  );
}
