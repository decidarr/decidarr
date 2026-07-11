// App header: identity chip (left, opens IdentityGate as a sheet),
// Movies/TV segmented control (center), filter button with active-count
// badge (right).
import { SlidersHorizontal, User } from "lucide-react";

import type { Player, Stream } from "../types";
import { S } from "../strings";

interface HeaderProps {
  player: Player | null;
  stream: Stream;
  setStream: (s: Stream) => void;
  filterCount: number;
  onOpenIdentity: () => void;
  onOpenFilters: () => void;
}

export function Header({
  player,
  stream,
  setStream,
  filterCount,
  onOpenIdentity,
  onOpenFilters,
}: HeaderProps) {
  return (
    <header className="app-header">
      <button
        type="button"
        className="identity-pill"
        onClick={onOpenIdentity}
        aria-label={S.identity.change}
      >
        {player?.emoji ? (
          <span className="identity-pill__emoji">{player.emoji}</span>
        ) : (
          <User size={16} aria-hidden="true" />
        )}
        <span className="identity-pill__name">{player?.name ?? S.identity.title}</span>
      </button>

      <div className="segmented" role="group" aria-label={S.streams.groupLabel}>
        {(["movie", "tv"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={"segmented__option" + (stream === s ? " segmented__option--active" : "")}
            aria-pressed={stream === s}
            onClick={() => setStream(s)}
          >
            {S.streams[s]}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={"filter-button" + (filterCount > 0 ? " filter-button--active" : "")}
        onClick={onOpenFilters}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>{S.filters.button(filterCount)}</span>
      </button>
    </header>
  );
}
