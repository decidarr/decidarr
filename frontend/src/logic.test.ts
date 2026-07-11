import { describe, expect, it } from "vitest";
import { eligibleItems, maskTitle, pickWinner, verdictToAction } from "./logic";
import type { PoolItem } from "./types";

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
