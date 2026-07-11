import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, useSession } from "./store";

describe("session store", () => {
  beforeEach(() => useSession.setState({
    playerId: null, stream: "movie", blind: false,
    filters: { ...DEFAULT_FILTERS } }));

  it("switches stream and persists filters per session", () => {
    useSession.getState().setStream("tv");
    expect(useSession.getState().stream).toBe("tv");
  });
  it("resetFilters restores defaults", () => {
    useSession.getState().setFilters({ ...DEFAULT_FILTERS, decade: 1980 });
    useSession.getState().resetFilters();
    expect(useSession.getState().filters).toEqual(DEFAULT_FILTERS);
  });
});
