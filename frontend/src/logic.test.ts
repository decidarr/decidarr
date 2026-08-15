import { describe, expect, it } from "vitest";
import {
  PROGRESS_POLL_CAP,
  STUCK_SEARCHING_MS,
  activeFilterCount,
  activePreset,
  applyPresetRange,
  buildPlayerStatRows,
  computeFlavorTitles,
  eligibleItems,
  fanPosters,
  shuffleReel,
  formatMetaLine,
  formatWhen,
  heroCountLine,
  heroReadyLine,
  maskTitle,
  pickWinner,
  posterUrl,
  progressDisplay,
  verdictToAction,
} from "./logic";
import { S } from "./strings";
import type { Player, PoolItem, Progress } from "./types";

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

describe("posterUrl", () => {
  it("prefixes a bare TMDB poster_path with the CDN host + size", () => {
    expect(posterUrl("/abc.jpg")).toBe(
      "https://image.tmdb.org/t/p/w500/abc.jpg");
  });
  it("tolerates a bare path missing its leading slash", () => {
    expect(posterUrl("abc.jpg")).toBe(
      "https://image.tmdb.org/t/p/w500/abc.jpg");
  });
  it("passes an already-absolute URL through untouched", () => {
    expect(posterUrl("https://cdn.example/x.jpg"))
      .toBe("https://cdn.example/x.jpg");
    expect(posterUrl("http://plex.local/photo?token=1"))
      .toBe("http://plex.local/photo?token=1");
  });
  it("returns null for null/undefined/empty so the fallback renders", () => {
    expect(posterUrl(null)).toBeNull();
    expect(posterUrl(undefined)).toBeNull();
    expect(posterUrl("")).toBeNull();
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



describe("verdictToAction", () => {
  it("maps verdicts to buttons", () => {
    expect(verdictToAction("available", true)).toBe("watch");
    expect(verdictToAction("pending", true)).toBe("progress");
    expect(verdictToAction("unrequested", true)).toBe("summon");
    expect(verdictToAction("unrequested", false)).toBe("configure");
    expect(verdictToAction("notfound", true)).toBe("manual");
  });
  it("unknown summons when Seerr is configured, hints configure when it isn't", () => {
    expect(verdictToAction("unknown", true)).toBe("summon");
    expect(verdictToAction("unknown", false)).toBe("configure");
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
  it("masked shows runtime only — year, rating and rank are giveaways", () => {
    expect(formatMetaLine(item({}), "movie", true)).toBe("136m");
    expect(formatMetaLine(item({ runtime: null }), "movie", true)).toBe("");
    // unmasked stays byte-identical
    expect(formatMetaLine(item({}), "movie", false)).toBe("1999 · 136m · ★8.2 · #1");
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
        { id: 1, name: "Tim", watched: 3, requested: 0, spun: 0, vetoed: 1 },
        { id: 2, name: "Sam", watched: 0, requested: 0, spun: 0, vetoed: 0 },
      ]);
  });

  it("defaults players missing entirely from the stats map to all zeros", () => {
    expect(buildPlayerStatRows(players, {})).toEqual([
      { id: 1, name: "Tim", watched: 0, requested: 0, spun: 0, vetoed: 0 },
      { id: 2, name: "Sam", watched: 0, requested: 0, spun: 0, vetoed: 0 },
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
      Tim: { vetoed: 3 },
      Sam: { requested: 5 },
    });
    expect(computeFlavorTitles(rows)).toEqual([
      { playerId: 1, label: S.flavorTitles.mostVetoed },
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

describe("heroCountLine", () => {
  it("pluralizes films by stream", () => {
    expect(heroCountLine(214, "movie", false))
      .toBe("Choosing from 214 unseen films.");
    expect(heroCountLine(1, "movie", false))
      .toBe("Choosing from 1 unseen film.");
  });
  it("uses shows for tv", () => {
    expect(heroCountLine(7, "tv", false))
      .toBe("Choosing from 7 unseen shows.");
  });
  it("appends the filter clause only when filters are active", () => {
    expect(heroCountLine(3, "movie", true))
      .toBe("Choosing from 3 unseen films that fit your filters.");
  });
  it("renders zero honestly", () => {
    expect(heroCountLine(0, "movie", true))
      .toBe("Choosing from 0 unseen films that fit your filters.");
  });
});

describe("heroReadyLine", () => {
  it("counts the rest of the wheel", () => {
    expect(heroReadyLine(213)).toBe("Another 213 in the wheel.");
    expect(heroReadyLine(1)).toBe("One more in the wheel.");
    expect(heroReadyLine(0)).toBe("Nothing else in the wheel right now.");
  });
});

describe("activePreset", () => {
  const F0 = { runtimeMin: 0, runtimeMax: Infinity, genres: [], decade: null,
               includeSeen: false };
  it("recognizes each named preset per stream", () => {
    expect(activePreset({ ...F0, runtimeMin: 40, runtimeMax: 110 }, "movie"))
      .toBe("schoolNight");
    expect(activePreset({ ...F0, runtimeMin: 110, runtimeMax: 210 }, "movie"))
      .toBe("committed");
    expect(activePreset({ ...F0, runtimeMin: 15, runtimeMax: 35 }, "tv"))
      .toBe("schoolNight");
    expect(activePreset({ ...F0, runtimeMin: 35, runtimeMax: 90 }, "tv"))
      .toBe("committed");
  });
  it("unbounded range is Whatever, including null-coalesced bounds", () => {
    expect(activePreset(F0, "movie")).toBe("whatever");
    // a localStorage round-trip turns Infinity into null — same as unbounded
    expect(activePreset({ ...F0, runtimeMin: null, runtimeMax: null }, "movie"))
      .toBe("whatever");
  });
  it("any other range matches nothing", () => {
    expect(activePreset({ ...F0, runtimeMin: 40, runtimeMax: 120 }, "movie"))
      .toBeNull();
    // a movie preset's range is not a tv preset
    expect(activePreset({ ...F0, runtimeMin: 40, runtimeMax: 110 }, "tv"))
      .toBeNull();
  });
});

describe("fanPosters", () => {
  const withPoster = (id: number) =>
    item({ id, item_key: `tmdb:${id}`, poster: `/p${id}.jpg` });
  const noPoster = (id: number) =>
    item({ id, item_key: `tmdb:${id}`, poster: null });

  it("samples up to n distinct poster urls from items that have art", () => {
    const items = [withPoster(1), withPoster(2), withPoster(3),
                   withPoster(4), withPoster(5), noPoster(6)];
    const fan = fanPosters(items, 4, () => 0);
    expect(fan).toHaveLength(4);
    expect(new Set(fan).size).toBe(4);
    for (const url of fan) {
      expect(url).toMatch(/^https:\/\/image\.tmdb\.org\/t\/p\/w500\/p\d\.jpg$/);
    }
  });
  it("returns fewer when the pool is small, empty under 2 candidates", () => {
    expect(fanPosters([withPoster(1), withPoster(2), withPoster(3)], 4, () => 0))
      .toHaveLength(3);
    expect(fanPosters([withPoster(1), noPoster(2)], 4, () => 0)).toEqual([]);
    expect(fanPosters([], 4, () => 0)).toEqual([]);
  });
  it("is deterministic with an injected rand", () => {
    const items = [withPoster(1), withPoster(2), withPoster(3), withPoster(4)];
    expect(fanPosters(items, 2, () => 0.99))
      .toEqual(fanPosters(items, 2, () => 0.99));
  });
});

describe("applyPresetRange", () => {
  it("maps preset keys to their stream's ranges", () => {
    expect(applyPresetRange("schoolNight", "movie"))
      .toEqual({ runtimeMin: 40, runtimeMax: 110 });
    expect(applyPresetRange("committed", "tv"))
      .toEqual({ runtimeMin: 35, runtimeMax: 90 });
    expect(applyPresetRange("whatever", "movie"))
      .toEqual({ runtimeMin: 0, runtimeMax: Infinity });
  });
});

describe("shuffleReel", () => {
  const withPoster = (id: number) =>
    item({ id, item_key: `tmdb:${id}`, poster: `/p${id}.jpg` });

  it("samples up to n distinct items from the deck", () => {
    const deck = Array.from({ length: 30 }, (_, i) => withPoster(i + 1));
    const reel = shuffleReel(deck, 14, () => 0);
    expect(reel).toHaveLength(14);
    expect(new Set(reel.map((i) => i.item_key)).size).toBe(14);
    for (const it of reel) expect(deck).toContain(it);
  });

  it("returns the whole deck when smaller than n, and [] for []", () => {
    const deck = [withPoster(1), withPoster(2)];
    expect(shuffleReel(deck, 14, () => 0)).toHaveLength(2);
    expect(shuffleReel([], 14, () => 0)).toEqual([]);
  });

  it("is deterministic with an injected rand", () => {
    const deck = Array.from({ length: 10 }, (_, i) => withPoster(i + 1));
    const a = shuffleReel(deck, 5, () => 0.5);
    const b = shuffleReel(deck, 5, () => 0.5);
    expect(a.map((i) => i.item_key)).toEqual(b.map((i) => i.item_key));
  });
});
