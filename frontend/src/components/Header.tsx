// App header (mobile): identity chip (left, opens IdentityGate as a sheet)
// and the Movies/TV segmented control (right). Filters used to live here
// behind a button — v1.3 moved them into the always-visible Console on the
// spin view, so the header is down to identity + stream.
import { User } from "lucide-react";

import type { Player, Stream } from "../types";
import { S } from "../strings";

interface HeaderProps {
  player: Player | null;
  stream: Stream;
  setStream: (s: Stream) => void;
  onOpenIdentity: () => void;
}

export function Header({ player, stream, setStream, onOpenIdentity }: HeaderProps) {
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
    </header>
  );
}
