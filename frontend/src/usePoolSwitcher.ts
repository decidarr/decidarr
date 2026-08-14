import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, activatePool, listPools } from "./api";
import { useSession } from "./store";
import { S } from "./strings";
import { pinAwareMessage, withAdminPin } from "./components/AdminPin";
import { toast } from "./components/Toast";

/** The room's list switcher, shared by the mobile Console and the desktop
 * ZenStrip: pools for the current stream, the active one, and an
 * admin-gated switch that refreshes everything downstream. Extracted from
 * Console (v1.4) verbatim so both homes stay in lockstep. */
export function usePoolSwitcher() {
  const { stream } = useSession();
  const queryClient = useQueryClient();
  const poolsQuery = useQuery({ queryKey: ["pools"], queryFn: listPools });
  const streamPools = (poolsQuery.data ?? []).filter((p) => p.media_type === stream);
  const activePool = streamPools.find((p) => !!p.active) ?? null;
  const [switching, setSwitching] = useState(false);

  async function switchPool(id: number) {
    if (id === activePool?.id) return;
    setSwitching(true);
    try {
      await withAdminPin(() => activatePool(id));
      const name = streamPools.find((p) => p.id === id)?.name;
      if (name) toast(S.pools.switched(name));
      queryClient.invalidateQueries({ queryKey: ["pools"] });
      queryClient.invalidateQueries({ queryKey: ["pool"] });
      queryClient.invalidateQueries({ queryKey: ["state"] });
    } catch (e) {
      toast(e instanceof ApiError ? pinAwareMessage(e.detail) : S.common.writeFailed);
    } finally {
      setSwitching(false);
    }
  }

  return { streamPools, activePool, switching, switchPool };
}
