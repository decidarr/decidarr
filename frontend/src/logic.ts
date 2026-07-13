import type {
  Filters, HistoryEntry, Player, PoolItem, Progress as ProgressData, StatsBundle,
  Stream, Verdict,
} from "./types";
import { S } from "./strings";

export function eligibleItems(items: PoolItem[], f: Filters,
                              seen: string[]): PoolItem[] {
  const seenSet = new Set(seen);
  return items.filter((it) => {
    if (!f.includeSeen && seenSet.has(it.item_key)) return false;
    // A localStorage round-trip can turn Infinity into null
    // (JSON.stringify(Infinity) === "null"), so default the bounds here —
    // don't "simplify" these coalesces away.
    const min = f.runtimeMin ?? 0;
    const max = f.runtimeMax ?? Infinity;
    if (it.runtime != null && (it.runtime < min || it.runtime > max)) return false;
    if (f.genres.length && it.genres.length &&
        !it.genres.some((g) => f.genres.includes(g))) return false;
    if (f.decade != null && it.year != null &&
        (it.year < f.decade || it.year >= f.decade + 10)) return false;
    return true;
  });
}

export function pickWinner(items: PoolItem[],
                           rand: () => number = Math.random): PoolItem | null {
  if (!items.length) return null;
  return items[Math.floor(rand() * items.length)];
}

export function verdictToAction(verdict: Verdict, seerrConfigured: boolean) {
  switch (verdict) {
    case "available": return "watch";
    case "pending": return "progress";
    case "unrequested": return seerrConfigured ? "summon" : "configure";
    case "notfound": return "manual";
    // "unknown" means we couldn't confirm status against Seerr — with Seerr
    // unconfigured that's the expected state, so hint the same "configure"
    // fix as the unrequested arm rather than offering a Summon that 503s.
    case "unknown": return seerrConfigured ? "summon" : "configure";
    default: return "summon";
  }
}

const MASK_WIDTH = 12;
export const maskTitle = (_title: string) => "▓".repeat(MASK_WIDTH);

export const spinDurations = (reducedMotion: boolean) =>
  reducedMotion ? { spin: 300, respin: 300, fate: 300 }
                : { spin: 2500, respin: 1200, fate: 1500 };

// --- duel (Task 21) ---------------------------------------------------

/** Candidates for one duel slot's spin: the normal eligible pool, minus
 * whatever the OTHER slot currently holds — duels never mirror-match a
 * title against itself. `excludeKey` is null when the other slot hasn't
 * landed on anything yet (first spin of a fresh duel). */
export function duelCandidates(
  items: PoolItem[], f: Filters, seen: string[], excludeKey: string | null,
): PoolItem[] {
  const pool = eligibleItems(items, f, seen);
  return excludeKey ? pool.filter((it) => it.item_key !== excludeKey) : pool;
}

/** Default second duelist for the 3+-player picker: the most recently
 * active player other than `currentId`, per `state.history[0..]` (newest
 * first). A history entry can reference a player who's since been
 * deactivated (no longer in `players` — /api/state's players list only
 * ever contains active players), so history hits are validated against
 * `players` before being trusted. Falls back to the first other active
 * player when history has nothing usable to say (fresh install, everyone's
 * history is `currentId`'s own, or the only history hit is deactivated).
 * Returns null only when no other active player exists to duel. */
export function defaultDuelOpponent(
  players: Player[], currentId: number | null, history: HistoryEntry[],
): number | null {
  if (currentId == null) return null;
  const activeIds = new Set(players.map((p) => p.id));
  const fromHistory = history.find((h) => h.player !== currentId && activeIds.has(h.player));
  if (fromHistory) return fromHistory.player;
  const other = players.find((p) => p.id !== currentId);
  return other ? other.id : null;
}

/** Count of non-default filter *fields* — drives the Header's "Filters · N"
 * badge. Runtime min/max count as a single field (one dual-handle range),
 * matching the player's mental model of "I set a runtime filter". */
export function activeFilterCount(f: Filters): number {
  let n = 0;
  if ((f.runtimeMin ?? 0) !== 0 || (f.runtimeMax ?? Infinity) !== Infinity) n++;
  if (f.genres.length > 0) n++;
  if (f.decade !== null) n++;
  if (f.includeSeen) n++;
  return n;
}

/** Meta line under a pick's title: year / runtime / (TV: seasons) /
 * rating / rank. Any missing field is simply omitted, never shown as a
 * placeholder — Swamp Roulette's card never rendered "null". */
export function formatMetaLine(item: PoolItem, stream: Stream): string {
  const parts: string[] = [];
  if (item.year != null) parts.push(String(item.year));
  if (item.runtime != null) parts.push(`${item.runtime}m`);
  if (stream === "tv" && item.seasons != null) {
    parts.push(`${item.seasons} season${item.seasons === 1 ? "" : "s"}`);
  }
  if (item.rating != null) parts.push(`★${item.rating.toFixed(1)}`);
  if (item.rank != null) parts.push(`#${item.rank}`);
  return parts.join(" · ");
}

// --- progress watcher: pure state -> display mapping -----------------------

/** Poll cadence/limits shared by the Progress component and its tests. */
export const PROGRESS_POLL_MS = 5000;
export const PROGRESS_POLL_CAP = 180;
export const STUCK_SEARCHING_MS = 10 * 60 * 1000; // 10 minutes

export type ProgressDisplay =
  | { kind: "hidden" }
  | { kind: "bar"; percent: number; eta: string | null; label: string }
  | { kind: "label"; text: string }
  | { kind: "done"; text: string }
  | { kind: "stuck"; text: string }
  | { kind: "capped"; text: string };

/** Maps a raw /api/progress result + poll bookkeeping to what the card
 * should show. Pure so the poll-cap and stuck-state decisions (the two
 * trickiest bits of the watcher) are unit-testable without mounting React
 * or faking timers inside a component. */
export function progressDisplay(
  p: ProgressData,
  stream: Stream,
  opts: { searchingMs: number; pollCount: number },
): ProgressDisplay {
  if (p.state === "unconfigured" || p.state === "unknown") return { kind: "hidden" };

  if (p.state === "done") {
    if (stream === "tv" && p.landed) {
      return { kind: "done", text: S.progress.landed(p.landed.ready, p.landed.total) };
    }
    return { kind: "done", text: S.progress.done };
  }

  // Poll-cap expiry outranks "searching" — an exhausted watcher shouldn't
  // keep suggesting it's still actively hunting.
  if (opts.pollCount >= PROGRESS_POLL_CAP) {
    return { kind: "capped", text: S.progress.checkBackLater };
  }

  if (p.state === "searching") {
    return opts.searchingMs >= STUCK_SEARCHING_MS
      ? { kind: "stuck", text: S.progress.stillHunting }
      : { kind: "label", text: S.progress.searching };
  }

  if (p.state === "importing") return { kind: "label", text: S.progress.importing };

  if (p.state === "queued" || p.state === "downloading") {
    return {
      kind: "bar",
      percent: p.percent,
      eta: p.eta,
      label: p.state === "queued" ? S.progress.queued : S.progress.downloading,
    };
  }

  return { kind: "hidden" };
}

// --- scoreboard (Task 22) ------------------------------------------------

export interface PlayerStatRow {
  id: number;
  name: string;
  watched: number;
  requested: number;
  spun: number;
  vetoed: number;
  duel_won: number;
}

/** Joins /api/stats' name-keyed `combined` map back onto player ids —
 * `db.stats()` groups by player NAME (see backend/db.py), so this is the
 * seam that makes the board (and flavor titles) id-addressable again.
 * Missing actions default to 0 rather than being omitted, so every row has
 * a stable shape for the board to render. */
export function buildPlayerStatRows(
  players: Player[], combined: StatsBundle["combined"],
): PlayerStatRow[] {
  return players.map((p) => {
    const s = combined[p.name] ?? {};
    return {
      id: p.id, name: p.name,
      watched: s.watched ?? 0, requested: s.requested ?? 0,
      spun: s.spun ?? 0, vetoed: s.vetoed ?? 0, duel_won: s.duel_won ?? 0,
    };
  });
}

export interface FlavorTitle {
  playerId: number;
  label: string;
}

/** "Most Vetoed" / "Duel Champion" / "The Summoner" — highest count per
 * category wins; ties go to the LOWER player id (deterministic, no
 * randomness in what's otherwise a scoreboard); a category where every
 * player is at 0 crowns nobody (never a 0-0 "winner"). Pure so the
 * tie/zero rules are unit-testable without mounting the Board. */
export function computeFlavorTitles(rows: PlayerStatRow[]): FlavorTitle[] {
  const crown = (
    key: "vetoed" | "duel_won" | "requested", label: string,
  ): FlavorTitle | null => {
    let best: PlayerStatRow | null = null;
    for (const r of rows) {
      if (r[key] <= 0) continue;
      if (!best || r[key] > best[key] || (r[key] === best[key] && r.id < best.id)) {
        best = r;
      }
    }
    return best ? { playerId: best.id, label } : null;
  };
  return [
    crown("vetoed", S.flavorTitles.mostVetoed),
    crown("duel_won", S.flavorTitles.duelChampion),
    crown("requested", S.flavorTitles.theSummoner),
  ].filter((t): t is FlavorTitle => t !== null);
}

const TMDB_IMG_BASE = "https://image.tmdb.org/t/p/w500";

/** Build a usable <img src> from a stored poster value. TMDB enrichment
 * stores the bare `poster_path` (e.g. "/abc.jpg"), which is NOT a loadable
 * URL on its own — it needs the TMDB CDN host + a size segment. Bare paths
 * get that prefix; anything already absolute (a media server may hand us a
 * full http/https URL) is passed through untouched; null/empty yields null
 * so the caller renders its poster fallback instead of a broken image. */
export function posterUrl(poster: string | null | undefined): string | null {
  if (!poster) return null;
  if (/^https?:\/\//i.test(poster)) return poster;
  return `${TMDB_IMG_BASE}${poster.startsWith("/") ? "" : "/"}${poster}`;
}

/** Human-readable local timestamp for history rows / pool refresh times.
 * Backend timestamps are UTC ISO-8601 (`db.utc_now()`); `Date` parses that
 * natively and formats in the viewer's local timezone. */
export function formatWhen(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
