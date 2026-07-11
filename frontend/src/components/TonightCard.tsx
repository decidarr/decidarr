// The committed pick, pinned above the Stage. Restored straight from
// `state.current_picks[stream]` on every page load — the wheel spins
// beneath it, and it only goes away via Mark watched or an explicit clear.
import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { clearPick, getStatus, postEvent } from "../api";
import { S } from "../strings";
import { useSession } from "../store";
import { toast } from "./Toast";
import { Progress } from "./Progress";
import { ConfirmSheet } from "./PickCard";
import type { CurrentPick } from "../types";

export interface TonightCardProps {
  pick: CurrentPick;
}

export function TonightCard({ pick }: TonightCardProps) {
  const { playerId } = useSession();
  const queryClient = useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);

  // Re-probe on every mount (including a hard refresh mid-download) —
  // progress is stateless server-side, so "resuming" is just polling again.
  const statusQuery = useQuery({
    queryKey: ["status", pick.media_type, pick.item_key],
    queryFn: () =>
      getStatus({ item_key: pick.item_key, type: pick.media_type, title: pick.title, year: pick.year }),
  });

  const verdict = statusQuery.data?.verdict;
  const available = verdict === "available";

  async function markWatched() {
    try {
      // Credited to whoever's marking it watched right now, not necessarily
      // whoever spun it originally — falls back to the original picker only
      // if for some reason no identity is active.
      await postEvent({
        player: playerId ?? pick.picked_by, media_type: pick.media_type, item_key: pick.item_key,
        title: pick.title, year: pick.year, action: "watched",
      });
      toast(S.watch.watchedConfirm);
      queryClient.invalidateQueries({ queryKey: ["state"] });
    } catch {
      toast(S.common.writeFailed);
    }
  }

  async function doClear() {
    try {
      await clearPick(pick.media_type);
      setConfirmClear(false);
      queryClient.invalidateQueries({ queryKey: ["state"] });
    } catch {
      toast(S.common.writeFailed);
    }
  }

  return (
    <div className="tonight-card">
      <div className="tonight-card__header">
        <span className="tonight-card__label">{S.tonight.title}</span>
        <button
          type="button"
          className="tonight-card__clear"
          onClick={() => setConfirmClear(true)}
          aria-label={S.watch.clearPick}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>

      <h3 className="tonight-card__title">{pick.title}</h3>
      <p className="tonight-card__meta">{pick.year ?? ""}</p>

      {available && (
        <span className="availability-chip availability-chip--available">
          <Check size={14} aria-hidden="true" />
          {statusQuery.data?.confidence === "fuzzy" ? S.availability.probably : S.availability.available}
        </span>
      )}

      {!available && (
        <Progress
          stream={pick.media_type}
          tmdb_id={pick.tmdb_id}
          tvdb_id={pick.tvdb_id}
          title={pick.title}
          year={pick.year}
          onDone={() => queryClient.invalidateQueries({ queryKey: ["status", pick.media_type, pick.item_key] })}
        />
      )}

      {available && statusQuery.data?.deep_link && (
        <a
          className="btn-primary tonight-card__watch"
          href={statusQuery.data.deep_link}
          target="_blank"
          rel="noreferrer"
        >
          {S.watch.letsWatch}
        </a>
      )}

      <button type="button" className="btn-primary tonight-card__markwatched" onClick={markWatched}>
        {S.watch.markWatched}
      </button>

      {confirmClear && (
        <ConfirmSheet
          title={S.watch.clearPick}
          body={S.watch.clearPickConfirm}
          confirmLabel={S.watch.clearPick}
          onConfirm={doClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
