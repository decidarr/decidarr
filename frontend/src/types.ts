// Types mirroring the Decidarr backend contract (backend/app.py, backend/db.py).
// Keep in sync with the Pydantic models and SQL row shapes there — this file
// (plus api.ts) is the contract every later frontend task builds on.

/** Movies and TV are never mixed in a single pool/wheel/spin. */
export type Stream = "movie" | "tv";

export interface Player {
  id: number;
  name: string;
  emoji: string | null;
  /** Present on /api/players; omitted from /api/state's players list
   * (which only ever contains active players). */
  active?: boolean | number;
}

export interface PoolItem {
  id: number;
  tmdb_id: number | null;
  /** Derived server-side: `tmdb:<id>` or `t:<normalized title>|<year>`. */
  item_key: string;
  title: string;
  year: number | null;
  runtime: number | null;
  seasons: number | null;
  genres: string[];
  rating: number | null;
  rank: number | null;
  poster: string | null;
}

/** Confidence of a title/year match against an external service. */
export type Confidence = "exact" | "fuzzy" | "none";

/** Final verdict surfaced by /api/status (Seerr status, optionally
 * overridden by a media-server "available" overlay). */
export type Verdict =
  | "available"
  | "pending"
  | "unrequested"
  | "notfound"
  | "unknown";

export interface StatusResult {
  verdict: Verdict;
  deep_link: string | null;
  confidence: Confidence;
}

/** Radarr/Sonarr download-progress state machine. */
export type ProgressState =
  | "unconfigured"
  | "unknown"
  | "searching"
  | "queued"
  | "downloading"
  | "importing"
  | "done";

export interface Progress {
  state: ProgressState;
  percent: number;
  eta: string | null;
  title: string | null;
  /** TV only: episodes of the requested season imported vs total. */
  landed?: { ready: number; total: number } | null;
}

export interface CurrentPick {
  media_type: Stream;
  item_key: string;
  title: string;
  year: number | null;
  tmdb_id: number | null;
  tvdb_id: number | null;
  picked_by: number;
  ts: string;
}

/** Client-side wheel filters — not sent to the backend as a single object. */
export interface Filters {
  runtimeMin: number | null;
  runtimeMax: number | null;
  genres: string[];
  decade: number | null;
  includeSeen: boolean;
}

export interface PoolInfo {
  id: number;
  name: string;
  source: "custom" | "tmdb" | "trakt";
  refreshed_at: string | null;
}

export interface HistoryEntry {
  ts: string;
  player: number;
  player_name: string;
  media_type: Stream;
  item_key: string;
  title: string;
  year: number | null;
  action: "watched" | "requested";
}

export interface GrudgeEntry {
  media_type: Stream;
  item_key: string;
  title: string;
  count: number;
  by: Record<string, number>;
}

/** Shape of GET /api/state. */
export interface StateBundle {
  players: Player[];
  pools: Record<Stream, PoolInfo | null>;
  current_picks: Partial<Record<Stream, CurrentPick>>;
  seen: Record<Stream, string[]>;
  /** Keyed by player id (JSON object keys are strings at runtime). */
  vetoes: Record<number, number>;
  veto_tokens: number;
  history: HistoryEntry[];
  grudges: GrudgeEntry[];
}

/** Shape of GET /api/health. */
export interface HealthResult {
  ok: boolean;
  version: string;
  seerr: boolean;
  radarr: boolean;
  sonarr: boolean;
  media_server: string | null;
  pools: Record<Stream, boolean>;
}

/** Shape of GET /api/stats (per-player action counts + derived flavor
 * inputs; scoreboard consumes this). */
export interface StatsBundle {
  movie: Record<string, Record<string, number>>;
  tv: Record<string, Record<string, number>>;
  combined: Record<string, Record<string, number>>;
  seen_total: number;
  top_grudges: GrudgeEntry[];
}

// --- request payloads (mirror backend Pydantic models) --------------------

export interface EventIn {
  player: number;
  media_type: Stream;
  item_key: string;
  title: string;
  year?: number | null;
  action: "spun" | "watched" | "seen";
}

export interface VetoIn {
  player: number;
  media_type: Stream;
  item_key: string;
  title: string;
  year?: number | null;
}

export interface WatchIn {
  player: number;
  media_type: Stream;
  item_key: string;
  title: string;
  year?: number | null;
  tmdb_id?: number | null;
  replace?: boolean;
}

export interface DuelWinIn {
  player: number;
  media_type: Stream;
  item_key: string;
  title: string;
  year?: number | null;
  tmdb_id?: number | null;
  replace?: boolean;
}

export interface StatusQuery {
  item_key: string;
  type: Stream;
  title: string;
  year?: number | null;
}

export interface ProgressQuery {
  type: Stream;
  tmdb?: number | null;
  tvdb?: number | null;
  title?: string | null;
  year?: number | null;
}

export interface PlayerIn {
  name: string;
  emoji?: string | null;
}

export interface PoolIn {
  name: string;
  media_type: Stream;
  source: "custom" | "tmdb" | "trakt";
  config: Record<string, unknown>;
}

export interface ConnectionField {
  value: string | null;
  masked: boolean;
  env: boolean;
}

export type ConnectionsBundle = Record<string, ConnectionField>;
