// History (recent watches/requests + grudge list) and Board (lazy-loaded
// scoreboard with computed flavor titles).
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { getStats } from "../api";
import { buildPlayerStatRows, computeFlavorTitles, formatWhen } from "../logic";
import { S } from "../strings";
import { useSession } from "../store";
import type { GrudgeEntry, HistoryEntry, Player } from "../types";

// --- History -------------------------------------------------------------

export interface HistoryProps {
  history: HistoryEntry[];
  grudges: GrudgeEntry[];
}

export function History({ history, grudges }: HistoryProps) {
  const { stream } = useSession();
  const [historyOpen, setHistoryOpen] = useState(true);
  const [grudgesOpen, setGrudgesOpen] = useState(true);

  const filteredHistory = history.filter((h) => h.media_type === stream);
  const filteredGrudges = grudges.filter((g) => g.media_type === stream);

  return (
    <div className="history-view">
      <CollapsibleSection
        title={S.history.title}
        open={historyOpen}
        onToggle={() => setHistoryOpen((o) => !o)}
      >
        {filteredHistory.length === 0 ? (
          <p className="settings-empty">{S.history.empty}</p>
        ) : (
          <ul className="history-list">
            {filteredHistory.map((h, i) => (
              <li key={`${h.ts}-${h.item_key}-${i}`} className="history-list__row">
                <span className="history-list__title">{h.title}</span>
                <span className="history-list__meta">
                  {h.player_name} · {S.history.action[h.action]} · {formatWhen(h.ts)}
                  {h.source === "auto" && (
                    <span className="history__auto">
                      <Zap size={12} aria-hidden="true" />
                      {S.history.autoTag}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={S.history.grudgesTitle}
        open={grudgesOpen}
        onToggle={() => setGrudgesOpen((o) => !o)}
      >
        {filteredGrudges.length === 0 ? (
          <p className="settings-empty">{S.history.grudgesEmpty}</p>
        ) : (
          <ul className="history-list">
            {filteredGrudges.map((g) => (
              <li key={`${g.media_type}:${g.item_key}`} className="history-list__row">
                <span className="history-list__title">{g.title}</span>
                <span className="history-list__meta">
                  {S.history.grudgeCount(g.count)} —{" "}
                  {Object.entries(g.by).map(([name, n]) => `${name} ×${n}`).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
    </div>
  );
}

function CollapsibleSection({
  title, open, onToggle, children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="collapsible">
      <button
        type="button"
        className="collapsible__toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        <span>{title}</span>
      </button>
      {open && <div className="collapsible__body">{children}</div>}
    </section>
  );
}

// --- Board (scoreboard) ---------------------------------------------------

export interface BoardProps {
  players: Player[];
}

export function Board({ players }: BoardProps) {
  // Lazy-loaded: the stats query stays disabled until this component has
  // actually mounted (i.e. the player opened the Board tab) — never fired
  // just because the app shell rendered.
  const [opened, setOpened] = useState(false);
  useEffect(() => { setOpened(true); }, []);
  const statsQuery = useQuery({ queryKey: ["stats"], queryFn: getStats, enabled: opened });

  if (!statsQuery.data) {
    return <p className="settings-empty">{S.board.loading}</p>;
  }

  const stats = statsQuery.data;
  const rows = buildPlayerStatRows(players, stats.combined);
  const titles = computeFlavorTitles(rows);
  const titlesByPlayer = new Map<number, string[]>();
  for (const t of titles) {
    titlesByPlayer.set(t.playerId, [...(titlesByPlayer.get(t.playerId) ?? []), t.label]);
  }

  return (
    <div className="board-view">
      <p className="board-view__seen-total">
        {S.board.seenTotal}: {stats.seen_total}
      </p>

      {rows.length === 0 ? (
        <p className="settings-empty">{S.board.empty}</p>
      ) : (
        <ul className="board-list">
          {rows.map((r) => (
            <li key={r.id} className="board-list__row">
              <div className="board-list__header">
                <span className="board-list__name">{r.name}</span>
                {(titlesByPlayer.get(r.id) ?? []).map((label) => (
                  <span key={label} className="board-list__flavor">{label}</span>
                ))}
              </div>
              <div className="board-list__stats">
                <span>{S.board.stat.watched}: {r.watched}</span>
                <span>{S.board.stat.requested}: {r.requested}</span>
                <span>{S.board.stat.spun}: {r.spun}</span>
                <span>{S.board.stat.vetoed}: {r.vetoed}</span>
                <span>{S.board.stat.duelWon}: {r.duel_won}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {stats.top_grudges.length > 0 && (
        <div className="board-view__grudges">
          <h3 className="board-view__grudges-title">{S.history.grudgesTitle}</h3>
          <ul className="history-list">
            {stats.top_grudges.map((g) => (
              <li key={`${g.media_type}:${g.item_key}`} className="history-list__row">
                <span className="history-list__title">{g.title}</span>
                <span className="history-list__meta">{S.history.grudgeCount(g.count)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- desktop rail variants (v1.3 two-pane theater) ------------------------

const RAIL_HISTORY_ROWS = 6;
const RAIL_GRUDGE_ROWS = 2;

/** Compact history + grudges for the desktop rail: the latest few rows for
 * the current stream, no collapsibles — the full History view is still one
 * nav click away. Reads the already-fetched /api/state, no new requests. */
export function HistoryRail({ history, grudges }: HistoryProps) {
  const { stream } = useSession();
  const rows = history
    .filter((h) => h.media_type === stream)
    .slice(0, RAIL_HISTORY_ROWS);
  const topGrudges = grudges
    .filter((g) => g.media_type === stream)
    .slice(0, RAIL_GRUDGE_ROWS);

  return (
    <section className="rail-card">
      <div className="rail-card__label rail-card__label--ember">{S.history.railTitle}</div>
      {rows.length === 0 ? (
        <p className="settings-empty">{S.history.empty}</p>
      ) : (
        <ul className="history-list">
          {rows.map((h, i) => (
            <li key={`${h.ts}-${h.item_key}-${i}`} className="history-list__row">
              <span className="history-list__title">{h.title}</span>
              <span className="history-list__meta">
                {h.player_name} · {S.history.action[h.action]} · {formatWhen(h.ts)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {topGrudges.length > 0 && (
        <ul className="history-list">
          {topGrudges.map((g) => (
            <li key={`${g.media_type}:${g.item_key}`} className="history-list__row">
              <span className="history-list__title">{g.title}</span>
              <span className="history-list__meta history-list__meta--grudge">
                {S.history.grudgeCount(g.count)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Compact scoreboard for the desktop rail: per-player watched counts and
 * the reigning Duel Champion — never a 0-0 crown, since computeFlavorTitles
 * only crowns a category somebody has actually scored in. */
export function BoardStrip({ players }: BoardProps) {
  const statsQuery = useQuery({ queryKey: ["stats"], queryFn: getStats });
  if (!statsQuery.data) return null;

  const rows = buildPlayerStatRows(players, statsQuery.data.combined);
  const champion = computeFlavorTitles(rows)
    .find((t) => t.label === S.flavorTitles.duelChampion);
  const championName = champion
    ? rows.find((r) => r.id === champion.playerId)?.name ?? null
    : null;

  return (
    <section className="rail-card">
      <div className="rail-card__label">{S.board.railTitle}</div>
      <div className="board-strip">
        {rows.map((r) => (
          <div key={r.id} className="board-strip__player">
            <span className="board-strip__name">{r.name}</span>
            <span className="board-strip__stat">{r.watched}</span>
            <span className="board-strip__cap">{S.board.stat.watched}</span>
          </div>
        ))}
      </div>
      {championName && (
        <div className="board-strip__champion">
          {S.flavorTitles.duelChampion}: {championName}
        </div>
      )}
    </section>
  );
}
