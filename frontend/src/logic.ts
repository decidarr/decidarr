import type { Filters, PoolItem, Verdict } from "./types";

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
