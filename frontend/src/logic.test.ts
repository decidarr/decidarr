import { describe, expect, it } from "vitest";
import {
  PROGRESS_POLL_CAP,
  STUCK_SEARCHING_MS,
  activeFilterCount,
  buildPlayerStatRows,
  computeFlavorTitles,
  defaultDuelOpponent,
  duelCandidates,
  eligibleItems,
  formatMetaLine,
  formatWhen,
  maskTitle,
  pickWinner,
  progressDisplay,
  verdictToAction,
} from "./logic";
import { S } from "./strings";
import type { HistoryEntry, Player, PoolItem, Progress } from "./types";

const item = (over: Partial<PoolItem>): PoolItem => ({
  id: 1, tmdb_id: 603, item_key: "tmdb:603", title: "The Matrix",
  year: 1999, runtime: 136, seasons: null, genres: ["Action"],
  rating: 8.2, rank: 1, poster: "/m.jpg", ...over,
});
const F = { runtimeMin: 0, runtimeMax: Infinity, genres: [], decade: null,
            includeSeen: false };

describe("eligibleItems", () => {
  it("excludes seen by default, readmits with includeSeen", () => {
    const items = [item({}), item({ id: 2, item_key: "tmdb:604" })];
    expect(eligibleItems(items, F, ["tmdb:603"])).toHaveLength(1);
    expect(eligibleItems(items, { ...F, includeSeen: true }, ["tmdb:603"]))
      .toHaveLength(2);
  });
  it("null metadata matches every filter", () => {
    const bare = item({ runtime: null, genres: [], year: null });
    const strict = { ...F, runtimeMin: 90, runtimeMax: 120,
                     genres: ["Drama"], decade: 1990 };
    expect(eligibleItems([bare], strict, [])).toHaveLength(1);
  });
  it("applies runtime, genre, and decade", () => {
    const items = [item({}), item({ id: 2, item_key: "t:x|1975", year: 1975,
                                    runtime: 90, genres: ["Drama"] })];
    expect(eligibleItems(items, { ...F, decade: 1990 }, [])).toHaveLength(1);
    expect(eligibleItems(items, { ...F, genres: ["Drama"] }, []))
      .toEqual([items[1]]);
    expect(eligibleItems(items, { ...F, runtimeMin: 100 }, []))
      .toEqual([items[0]]);
  });
});

describe("pickWinner", () => {
  it("chooses uniformly with injected rand and nulls on empty", () => {
    const items = [item({}), item({ id: 2 }), item({ id: 3 })];
    expect(pickWinner(items, () => 0.99)!.id).toBe(3);
    expect(pickWinner(items, () => 0)!.id).toBe(1);
    expect(pickWinner([], () => 0.5)).toBeNull();
  });
});

describe("duelCandidates", () => {
  it("excludes the other slot's current item on top of normal eligibility", () => {
    const items = [item({}), item({ id: 2, item_key: "tmdb:604" }),
                   item({ id: 3, item_key: "tmdb:605" })];
    expect(duelCandidates(items, F, [], "tmdb:604").map((i) => i.item_key))
      .toEqual(["tmdb:603", "tmdb:605"]);
  });
  it("passes through unchanged when nothing to exclude yet", () => {
    const items = [item({}), item({ id: 2, item_key: "tmdb:604" })];
    expect(duelCandidates(items, F, [], null)).toEqual(items);
  });
  it("still respects seen/filters before excluding", () => {
    const items = [item({}), item({ id: 2, item_key: "tmdb:604" })];
    expect(duelCandidates(items, F, ["tmdb:603"], "tmdb:604")).toEqual([]);
  });
});

describe("defaultDuelOpponent", () => {
  const players: Player[] = [
    { id: 1, name: "Alice", emoji: null },
    { id: 2, name: "Bob", emoji: null },
    { id: 3, name: "Cara", emoji: null },
  ];
  const hist = (player: number): HistoryEntry => ({
    ts: "2026-07-11T00:00:00Z", player, player_name: "x", media_type: "movie",
    item_key: "tmdb:1", title: "x", year: null, action: "watched",
  });

  it("picks the most recently active other player from history", () => {
    expect(defaultDuelOpponent(players, 1, [hist(3), hist(2)])).toBe(3);
  });
  it("skips history entries belonging to the current player", () => {
    expect(defaultDuelOpponent(players, 1, [hist(1), hist(1), hist(2)])).toBe(2);
  });
  it("falls back to the first other active player with no usable history", () => {
    expect(defaultDuelOpponent(players, 1, [])).toBe(2);
    expect(defaultDuelOpponent(players, 1, [hist(1)])).toBe(2);
  });
  it("returns null with no current identity or no other players", () => {
    expect(defaultDuelOpponent(players, null, [])).toBeNull();
    expect(defaultDuelOpponent([players[0]], 1, [])).toBeNull();
  });
});

describe("verdictToAction", () => {
  it("maps verdicts to buttons", () => {
    expect(verdictToAction("available", true)).toBe("watch");
    expect(verdictToAction("pending", true)).toBe("progress");
    expect(verdictToAction("unrequested", true)).toBe("summon");
    expect(verdictToAction("unrequested", false)).toBe("configure");
    expect(verdictToAction("notfound", true)).toBe("manual");
  });
});

describe("maskTitle", () => {
  it("uses a fixed width so length never leaks", () => {
    expect(maskTitle("It")).toBe(maskTitle("The Assassination of Jesse James"));
    expect(maskTitle("It")).toMatch(/^▓+$/);
  });
});

describe("activeFilterCount", () => {
  it("is zero for the default filters", () => {
    expect(activeFilterCount(F)).toBe(0);
  });
  it("counts runtime min/max as a single field", () => {
    expect(activeFilterCount({ ...F, runtimeMin: 40 })).toBe(1);
    expect(activeFilterCount({ ...F, runtimeMax: 110 })).toBe(1);
    expect(activeFilterCount({ ...F, runtimeMin: 40, runtimeMax: 110 })).toBe(1);
  });
  it("counts genres, decade, and includeSeen independently", () => {
    expect(activeFilterCount({ ...F, genres: ["Drama"] })).toBe(1);
    expect(activeFilterCount({ ...F, decade: 1990 })).toBe(1);
    expect(activeFilterCount({ ...F, includeSeen: true })).toBe(1);
    expect(activeFilterCount({
      ...F, runtimeMin: 40, genres: ["Drama"], decade: 1990, includeSeen: true,
    })).toBe(4);
  });
});

describe("formatMetaLine", () => {
  it("joins year/runtime/rating/rank, omitting missing fields", () => {
    expect(formatMetaLine(item({}), "movie")).toBe("1999 · 136m · ★8.2 · #1");
    expect(formatMetaLine(item({ runtime: null, rating: null, rank: null }), "movie"))
      .toBe("1999");
  });
  it("adds a pluralized season count for TV, ignored for movies", () => {
    const show = item({ seasons: 3 });
    expect(formatMetaLine(show, "tv")).toBe("1999 · 136m · 3 seasons · ★8.2 · #1");
    expect(formatMetaLine(item({ seasons: 1 }), "tv"))
      .toBe("1999 · 136m · 1 season · ★8.2 · #1");
    expect(formatMetaLine(show, "movie")).not.toContain("season");
  });
});

describe("progressDisplay", () => {
  const p = (over: Partial<Progress>): Progress =>
    ({ state: "queued", percent: 0, eta: null, title: null, ...over });
  const noPoll = { searchingMs: 0, pollCount: 0 };

  it("hides for unconfigured/unknown", () => {
    expect(progressDisplay(p({ state: "unconfigured" }), "movie", noPoll))
      .toEqual({ kind: "hidden" });
    expect(progressDisplay(p({ state: "unknown" }), "movie", noPoll))
      .toEqual({ kind: "hidden" });
  });

  it("shows a bar with eta for queued/downloading", () => {
    const d = progressDisplay(p({ state: "downloading", percent: 42, eta: "5m" }),
      "movie", noPoll);
    expect(d).toEqual({ kind: "bar", percent: 42, eta: "5m", label: S.progress.downloading });
  });

  it("importing is a plain label", () => {
    expect(progressDisplay(p({ state: "importing" }), "movie", noPoll))
      .toEqual({ kind: "label", text: S.progress.importing });
  });

  it("done maps to the movie copy, or TV's landed count when present", () => {
    expect(progressDisplay(p({ state: "done" }), "movie", noPoll))
      .toEqual({ kind: "done", text: S.progress.done });
    const tv = progressDisplay(p({ state: "done", landed: { ready: 3, total: 10 } }),
      "tv", noPoll);
    expect(tv).toEqual({ kind: "done", text: S.progress.landed(3, 10) });
  });

  it("searching stays a label until it's been stuck for 10+ minutes", () => {
    expect(progressDisplay(p({ state: "searching" }), "movie",
      { searchingMs: STUCK_SEARCHING_MS - 1, pollCount: 0 }))
      .toEqual({ kind: "label", text: S.progress.searching });
    expect(progressDisplay(p({ state: "searching" }), "movie",
      { searchingMs: STUCK_SEARCHING_MS, pollCount: 0 }))
      .toEqual({ kind: "stuck", text: S.progress.stillHunting });
  });

  it("poll-cap expiry outranks searching", () => {
    expect(progressDisplay(p({ state: "searching" }), "movie",
      { searchingMs: 0, pollCount: PROGRESS_POLL_CAP }))
      .toEqual({ kind: "capped", text: S.progress.checkBackLater });
  });

  it("does not cap a state that has already landed", () => {
    expect(progressDisplay(p({ state: "done" }), "movie",
      { searchingMs: 0, pollCount: PROGRESS_POLL_CAP }))
      .toEqual({ kind: "done", text: S.progress.done });
  });
});

describe("buildPlayerStatRows / computeFlavorTitles", () => {
  const players: Player[] = [
    { id: 1, name: "Tim", emoji: null },
    { id: 2, name: "Sam", emoji: null },
  ];

  it("joins name-keyed stats back onto ids, defaulting missing actions to 0", () => {
    expect(buildPlayerStatRows(players, { Tim: { watched: 3, vetoed: 1 } }))
      .toEqual([
        { id: 1, name: "Tim", watched: 3, requested: 0, spun: 0, vetoed: 1, duel_won: 0 },
        { id: 2, name: "Sam", watched: 0, requested: 0, spun: 0, vetoed: 0, duel_won: 0 },
      ]);
  });

  it("defaults players missing entirely from the stats map to all zeros", () => {
    expect(buildPlayerStatRows(players, {})).toEqual([
      { id: 1, name: "Tim", watched: 0, requested: 0, spun: 0, vetoed: 0, duel_won: 0 },
      { id: 2, name: "Sam", watched: 0, requested: 0, spun: 0, vetoed: 0, duel_won: 0 },
    ]);
  });

  it("crowns nobody when every category is all-zero", () => {
    expect(computeFlavorTitles(buildPlayerStatRows(players, {}))).toEqual([]);
  });

  it("breaks ties by the lower player id", () => {
    const rows = buildPlayerStatRows(players, { Tim: { vetoed: 2 }, Sam: { vetoed: 2 } });
    expect(computeFlavorTitles(rows)).toEqual([
      { playerId: 1, label: S.flavorTitles.mostVetoed },
    ]);
  });

  it("crowns each category independently — one player can win more than one", () => {
    const rows = buildPlayerStatRows(players, {
      Tim: { vetoed: 3, duel_won: 1 },
      Sam: { duel_won: 4, requested: 5 },
    });
    expect(computeFlavorTitles(rows)).toEqual([
      { playerId: 1, label: S.flavorTitles.mostVetoed },
      { playerId: 2, label: S.flavorTitles.duelChampion },
      { playerId: 2, label: S.flavorTitles.theSummoner },
    ]);
  });

  it("a single non-zero player wins their categories outright", () => {
    const rows = buildPlayerStatRows(players, { Tim: { vetoed: 1 } });
    expect(computeFlavorTitles(rows)).toEqual([
      { playerId: 1, label: S.flavorTitles.mostVetoed },
    ]);
  });
});

describe("formatWhen", () => {
  it("formats a valid ISO timestamp without throwing", () => {
    expect(formatWhen("2026-07-11T20:15:00Z")).not.toBe("2026-07-11T20:15:00Z");
    expect(typeof formatWhen("2026-07-11T20:15:00Z")).toBe("string");
  });
  it("falls back to the raw string for unparseable input", () => {
    expect(formatWhen("not-a-date")).toBe("not-a-date");
  });
});
