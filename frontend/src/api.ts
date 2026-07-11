import type {
  ConnectionsBundle,
  DuelWinIn,
  EventIn,
  HealthResult,
  PlayerIn,
  Player,
  PoolIn,
  PoolItem,
  Progress,
  ProgressQuery,
  StateBundle,
  StatsBundle,
  StatusQuery,
  StatusResult,
  Stream,
  VetoIn,
  WatchIn,
} from "./types";

// import.meta.env.BASE_URL is Vite's runtime reflection of the `base` config
// value (which we set from URL_BASE at build time) — this makes every /api
// call automatically honor a non-root deployment path.
export const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

let adminPin: string | null = null;
export const setAdminPin = (pin: string) => {
  adminPin = pin;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(adminPin ? { "X-Admin-Pin": adminPin } : {}),
  };
  const res = await fetch(`${apiBase}/api${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail);
  }
  return res.json();
}

function toParams(q: object): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q) as [string, unknown][]) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  return params;
}

// --- core game surface ------------------------------------------------

export const getState = () => call<StateBundle>("/state");

export const getPool = (stream: Stream) =>
  call<PoolItem[]>(`/pool?stream=${stream}`);

export const getStatus = (q: StatusQuery) =>
  call<StatusResult>(`/status?${toParams(q)}`);

export const getProgress = (q: ProgressQuery) =>
  call<Progress>(`/progress?${toParams(q)}`);

export const postEvent = (e: EventIn) =>
  call<{ ok: boolean }>("/event", { method: "POST", body: JSON.stringify(e) });

export const postVeto = (v: VetoIn) =>
  call<{ ok: boolean; remaining: number }>("/veto", {
    method: "POST",
    body: JSON.stringify(v),
  });

export const postWatch = (w: WatchIn) =>
  call<{ verdict: string; deep_link?: string | null; requested?: boolean }>(
    "/watch",
    { method: "POST", body: JSON.stringify(w) },
  );

export const duelWin = (d: DuelWinIn) =>
  call<{ ok: boolean }>("/duel/win", {
    method: "POST",
    body: JSON.stringify(d),
  });

export const clearPick = (stream: Stream) =>
  call<{ ok: boolean }>(`/pick?stream=${stream}`, { method: "DELETE" });

export const resetSeen = (stream?: Stream) =>
  call<{ ok: boolean; deleted: number }>("/reset-seen", {
    method: "POST",
    body: JSON.stringify({ stream: stream ?? null }),
  });

export const getHealth = () => call<HealthResult>("/health");

export const getStats = () => call<StatsBundle>("/stats");

// --- admin: players -----------------------------------------------------

export const listPlayers = () => call<Player[]>("/players");

export const createPlayer = (p: PlayerIn) =>
  call<Player>("/players", { method: "POST", body: JSON.stringify(p) });

export const deactivatePlayer = (id: number) =>
  call<{ ok: boolean }>(`/players/${id}`, { method: "DELETE" });

// --- admin: pools ---------------------------------------------------------

export interface PoolRow {
  id: number;
  name: string;
  media_type: Stream;
  source: string;
  config: string;
  active: number;
  refreshed_at: string | null;
  item_count: number;
}

export const listPools = () => call<PoolRow[]>("/pools");

export const createPool = (p: PoolIn) =>
  call<{ id: number }>("/pools", { method: "POST", body: JSON.stringify(p) });

export const deletePool = (id: number) =>
  call<{ ok: boolean }>(`/pools/${id}`, { method: "DELETE" });

export const activatePool = (id: number) =>
  call<{ ok: boolean }>(`/pools/${id}/activate`, { method: "POST" });

export const refreshPool = (id: number) =>
  call<Record<string, unknown>>(`/pools/${id}/refresh`, { method: "POST" });

export const importPool = async (
  poolId: number,
  file: File,
): Promise<{ imported: number; unresolved: string[] }> => {
  const form = new FormData();
  form.append("pool_id", String(poolId));
  form.append("file", file);
  const res = await fetch(`${apiBase}/api/pools/import`, {
    method: "POST",
    headers: adminPin ? { "X-Admin-Pin": adminPin } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail);
  }
  return res.json();
};

// --- admin: connections -----------------------------------------------

export const getConnections = () => call<ConnectionsBundle>("/connections");

export const putConnections = (body: Record<string, string>) =>
  call<{ ok: boolean; skipped: string[] }>("/connections", {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const testConnection = (service: string) =>
  call<{ ok: boolean; message: string }>(`/connections/${service}/test`, {
    method: "POST",
  });
