import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUnsaved } from "./unsaved";

const S = () => useUnsaved.getState();

beforeEach(() => {
  useUnsaved.setState({ dirty: false, save: null, pendingNav: null });
});

describe("unsaved-changes navigation guard", () => {
  it("navigates immediately when nothing is dirty", () => {
    const nav = vi.fn();
    S().requestNav(nav);
    expect(nav).toHaveBeenCalledOnce();
    expect(S().pendingNav).toBeNull();
  });

  it("defers navigation and stashes it when dirty", () => {
    S().setGuard(true, async () => true);
    const nav = vi.fn();
    S().requestNav(nav);
    expect(nav).not.toHaveBeenCalled();
    expect(S().pendingNav).not.toBeNull();
  });

  it("stay drops the pending navigation and keeps the guard", () => {
    S().setGuard(true, async () => true);
    const nav = vi.fn();
    S().requestNav(nav);
    S().resolveStay();
    expect(nav).not.toHaveBeenCalled();
    expect(S().pendingNav).toBeNull();
    expect(S().dirty).toBe(true);
  });

  it("discard navigates without saving and clears the guard", () => {
    const save = vi.fn(async () => true);
    S().setGuard(true, save);
    const nav = vi.fn();
    S().requestNav(nav);
    S().resolveDiscard();
    expect(save).not.toHaveBeenCalled();
    expect(nav).toHaveBeenCalledOnce();
    expect(S().dirty).toBe(false);
  });

  it("save saves first, then navigates", async () => {
    const order: string[] = [];
    S().setGuard(true, async () => { order.push("save"); return true; });
    S().requestNav(() => order.push("nav"));
    await S().resolveSave();
    expect(order).toEqual(["save", "nav"]);
    expect(S().dirty).toBe(false);
  });

  it("a failed save stays put with the guard intact", async () => {
    S().setGuard(true, async () => false);
    const nav = vi.fn();
    S().requestNav(nav);
    await S().resolveSave();
    expect(nav).not.toHaveBeenCalled();
    expect(S().pendingNav).toBeNull();
    expect(S().dirty).toBe(true);
  });
});
