import { describe, expect, it } from "vitest";

import { ApiError, apiBase } from "./api";
import { S } from "./strings";

describe("scaffold smoke test", () => {
  it("apiBase resolves from BASE_URL", () => {
    expect(typeof apiBase).toBe("string");
  });

  it("ApiError carries status and detail", () => {
    const err = new ApiError(409, "pending_pick");
    expect(err.status).toBe(409);
    expect(err.detail).toBe("pending_pick");
    expect(err.message).toBe("pending_pick");
  });

  it("strings module exports player-facing copy", () => {
    expect(S.app.name).toBe("Decidarr");
  });
});
