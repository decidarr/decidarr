import type { Filters, PoolItem, Progress as ProgressData, Stream, Verdict } from "./types";
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
    default: return "summon";
  }
}

const MASK_WIDTH = 12;
export const maskTitle = (_title: string) => "▓".repeat(MASK_WIDTH);

export const spinDurations = (reducedMotion: boolean) =>
  reducedMotion ? { spin: 300, respin: 300, fate: 300 }
                : { spin: 2500, respin: 1200, fate: 1500 };

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
