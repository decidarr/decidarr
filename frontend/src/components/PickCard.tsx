// The landed pick, rendered by Stage once a spin settles. Poster, masked
// title in blind mode (first tap reveals, second tap acts), verdict-driven
// primary action, and the Veto/Seen-it row.
import { useEffect, useRef, useState } from "react";
import { Check, Eye, Play, ThumbsDown, Target } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, getHealth, getState, getStatus, postEvent, postVeto, postWatch } from "../api";
import { formatMetaLine, maskTitle, posterUrl, verdictToAction } from "../logic";
import { S } from "../strings";
import { toast } from "./Toast";
import { Progress } from "./Progress";
import { useSession } from "../store";
import type { PoolItem } from "../types";

export interface PickCardProps {
  item: PoolItem;
  /** Called after a spent veto is confirmed server-side (grace window
   * expired without Undo). `remaining` is the player's leftover tokens
   * tonight — Stage uses this to sass the toast and trigger a re-spin. */
  onVetoed: (remaining: number) => void;
  /** Called after `postWatch` commits this item as tonight's pick
   * (available-now or freshly requested), via either the initial commit
   * or the replace:true retry. Stage resets to the idle wheel and
   * invalidates `["state"]` so ONLY TonightCard represents the committed
   * pick (one card, one Progress watcher). */
  onCommitted: () => void;
  /** "Seen it" already watched this one — re-spin, same beat as veto. */
  onSeenIt?: () => void;
}

export function PickCard({ item, onVetoed, onCommitted, onSeenIt }: PickCardProps) {
  const { playerId, stream, blind } = useSession();
  const queryClient = useQueryClient();

  const [revealed, setRevealed] = useState(!blind);
  useEffect(() => setRevealed(!blind), [blind, item.item_key]);

  const [confirmReplace, setConfirmReplace] = useState(false);
  const [vetoPending, setVetoPending] = useState(false);
  const vetoTimer = useRef<number | null>(null);

  const stateQuery = useQuery({ queryKey: ["state"], queryFn: getState });
  const healthQuery = useQuery({ queryKey: ["health"], queryFn: getHealth, staleTime: 60_000 });
  const statusQuery = useQuery({
    queryKey: ["status", stream, item.item_key],
    queryFn: () => getStatus({ item_key: item.item_key, type: stream, title: item.title, year: item.year }),
  });

  const remainingVetoes = playerId != null ? stateQuery.data?.vetoes[playerId] : undefined;
  const vetoDisabled = remainingVetoes === 0;

  // --- veto (grace-window undo) -------------------------------------
  function fireVeto() {
    if (vetoTimer.current == null) return; // undone, or already fired
    vetoTimer.current = null;
    setVetoPending(false);
    if (playerId == null) return;
    postVetoNow();
  }

  async function postVetoNow() {
    try {
      const r = await postVeto({
        player: playerId!,
        media_type: stream,
        item_key: item.item_key,
        title: item.title,
        year: item.year,
      });
      onVetoed(r.remaining);
    } catch (e) {
      toast(e instanceof ApiError && e.detail === "no_tokens" ? S.veto.outOfTokens : S.common.writeFailed);
    }
  }

  function veto() {
    if (vetoDisabled) {
      toast(S.veto.outOfTokens);
      return;
    }
    // A second tap during the grace window would stack a duplicate toast
    // and a duplicate setTimeout — the pending one already covers it.
    if (vetoPending) return;
    setVetoPending(true);
    toast(S.veto.undoPrompt, {
      actionLabel: S.common.undo,
      ttl: 5000,
      onAction: () => {
        if (vetoTimer.current != null) window.clearTimeout(vetoTimer.current);
        vetoTimer.current = null;
        setVetoPending(false);
      },
      onExpire: fireVeto,
    });
    vetoTimer.current = window.setTimeout(fireVeto, 5000);
  }

  // Flush an in-flight veto on unmount — navigating away (respin, stream
  // switch) must not silently eat a pending veto.
  useEffect(() => () => { fireVeto(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- seen it ---------------------------------------------------------
  async function seenIt() {
    if (playerId == null) return;
    try {
      await postEvent({
        player: playerId, media_type: stream, item_key: item.item_key,
        title: item.title, year: item.year, action: "seen",
      });
      toast(S.watch.seenItRespin);
      onSeenIt?.();
    } catch {
      toast(S.common.writeFailed);
    }
  }

  // --- watch / summon ----------------------------------------------------
  async function commit(replace: boolean) {
    if (playerId == null) return;
    try {
      const r = await postWatch({
        player: playerId, media_type: stream, item_key: item.item_key,
        title: item.title, year: item.year, tmdb_id: item.tmdb_id, replace,
      });
      setConfirmReplace(false);
      // Deep link / requested toast BEFORE handing off — onCommitted resets
      // the Stage to idle, which unmounts this card.
      if (r.verdict === "available") {
        if (r.deep_link) window.open(r.deep_link, "_blank", "noopener");
      } else if (r.requested) {
        toast(S.watch.requested);
      }
      onCommitted();
    } catch (e) {
      if (e instanceof ApiError && e.detail === "pending_pick") {
        setConfirmReplace(true);
      } else {
        toast(S.common.writeFailed);
      }
    }
  }

  function primaryTap() {
    if (blind && !revealed) {
      setRevealed(true);
      return;
    }
    commit(false);
  }

  const verdict = statusQuery.data?.verdict;
  const action = statusQuery.isLoading || verdict == null
    ? null
    : verdictToAction(verdict, !!healthQuery.data?.seerr);

  const displayTitle = blind && !revealed ? maskTitle(item.title) : item.title;
  const available = verdict === "available";

  return (
    <div className="pick-card">
      <PosterBox item={item} />

      <h3 className="pick-card__title">{displayTitle}</h3>
      <p className="pick-card__meta">{formatMetaLine(item, stream)}</p>

      {available && (
        <span className="availability-chip availability-chip--available">
          <Check size={14} aria-hidden="true" />
          {statusQuery.data?.confidence === "fuzzy" ? S.availability.probably : S.availability.available}
        </span>
      )}

      <div className="pick-card__primary">
        {action === "progress" && (
          <Progress
            stream={stream}
            tmdb_id={item.tmdb_id}
            title={item.title}
            year={item.year}
            onDone={() => queryClient.invalidateQueries({ queryKey: ["status", stream, item.item_key] })}
          />
        )}
        {action === "watch" && (
          <button type="button" className="btn-primary" onClick={primaryTap}>
            <Play size={18} aria-hidden="true" />
            {S.watch.letsWatch}
          </button>
        )}
        {action === "summon" && (
          <button type="button" className="btn-primary" onClick={primaryTap}>
            <Target size={18} aria-hidden="true" />
            {S.watch.summonAction}
          </button>
        )}
        {action === "configure" && <p className="pick-card__hint">{S.watch.configureHint}</p>}
        {action === "manual" && <p className="pick-card__hint">{S.watch.manualHint}</p>}
      </div>

      <div className="pick-card__actions">
        <button type="button" className="btn-secondary" onClick={seenIt}>
          <Eye size={16} aria-hidden="true" />
          {S.watch.seenIt}
        </button>
        <button
          type="button"
          className={"btn-veto" + (vetoDisabled || vetoPending ? " btn-veto--disabled" : "")}
          aria-disabled={vetoDisabled || vetoPending}
          onClick={veto}
        >
          <ThumbsDown size={16} aria-hidden="true" />
          {S.veto.button}
        </button>
      </div>

      {confirmReplace && (
        <ConfirmSheet
          title={S.watch.pendingConflictTitle}
          body={S.watch.pendingConflict}
          confirmLabel={S.watch.replace}
          onConfirm={() => commit(true)}
          onCancel={() => setConfirmReplace(false)}
        />
      )}
    </div>
  );
}

function PosterBox({ item }: { item: PoolItem }) {
  const src = posterUrl(item.poster);
  return (
    <div className="poster-box">
      {src ? (
        <img className="poster-box__img" src={src} alt="" loading="lazy" />
      ) : (
        <div className="poster-box__fallback" />
      )}
      <div className="poster-box__scrim" />
    </div>
  );
}

/** Small confirm modal shared by the pending-pick replace flow (here) and
 * TonightCard's "clear pick" affordance. */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="sheet-overlay" role="presentation" onClick={onCancel}>
      <div
        className="sheet confirm-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sheet__title">{title}</h2>
        <p className="confirm-sheet__body">{body}</p>
        <div className="confirm-sheet__actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {S.common.cancel}
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
