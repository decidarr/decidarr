// Desktop (>=960px) chrome: the masthead lockup, the player + stream
// controls, and the nav that lives in the bottom bar on mobile. Replaces
// Header entirely at this width — the app finally says its own name.
import type { ReactNode } from "react";
import { Disc3, History as HistoryIcon, Settings as SettingsIcon, Trophy, User } from "lucide-react";

import { ReelMark } from "./ReelMark";
import { S } from "../strings";
import type { View } from "../App";
import type { Player, Stream } from "../types";

const NAV: Array<{ v: View; label: string; icon: ReactNode }> = [
  { v: "spin", label: S.nav.spin, icon: <Disc3 size={16} aria-hidden="true" /> },
  { v: "history", label: S.nav.history, icon: <HistoryIcon size={16} aria-hidden="true" /> },
  { v: "board", label: S.nav.board, icon: <Trophy size={16} aria-hidden="true" /> },
  { v: "settings", label: S.nav.settings, icon: <SettingsIcon size={16} aria-hidden="true" /> },
];

export function TopBar({
  player,
  stream,
  setStream,
  view,
  setView,
  onOpenIdentity,
}: {
  player: Player | null;
  stream: Stream;
  setStream: (s: Stream) => void;
  view: View;
  setView: (v: View) => void;
  onOpenIdentity: () => void;
}) {
  return (
    <header className="top-bar">
      {/* The masthead is a home button, per every site since 1996. */}
      <button
        type="button"
        className="top-bar__lockup"
        onClick={() => setView("spin")}
      >
        <ReelMark size={30} />
        <span className="marquee">
          Deci<span className="marquee__tail">darr</span>
        </span>
      </button>

      <span className="top-bar__center">
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
      </span>

      <nav className="top-bar__nav">
        {NAV.map(({ v, label, icon }) => (
          <button
            key={v}
            type="button"
            className={"top-bar__nav-item" + (view === v ? " top-bar__nav-item--active" : "")}
            aria-current={view === v ? "page" : undefined}
            onClick={() => setView(v)}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}
