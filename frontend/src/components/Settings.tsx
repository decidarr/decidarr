// Admin settings: Players, Pools, Connections. Each section is exported
// standalone so Onboarding can mount the same components inline as wizard
// steps — the wizard is just an ordered path through these, not a fork.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Check, List, Pencil, Plus, RefreshCw, Trash2, Upload, UserX } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ApiError, activatePool, backfillSeen, createPlayer, createPool, deactivatePlayer,
  deletePool, getConnections, getHealth, getPlexSections, getPoolItems, getState, getUpdate,
  importPool, listPlayers, listPools, patchPlayer, postEvent, putConnections,
  refreshPool, renamePool, testConnection,
} from "../api";
import type { PoolRow } from "../api";
import type { PoolItem } from "../types";
import { formatWhen } from "../logic";
import { S } from "../strings";
import { toast } from "./Toast";
import { pinAwareMessage, withAdminPin } from "./AdminPin";
import { useSession } from "../store";
import type { ConnectionsBundle, Player, Stream } from "../types";

export function isActive(p: Player): boolean {
  return p.active === 1 || p.active === true || p.active === undefined;
}


// --- Players --------------------------------------------------------------

export function PlayersSection() {
  const queryClient = useQueryClient();
  const playersQuery = useQuery({ queryKey: ["players"], queryFn: listPlayers });
  const healthQuery = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const server = healthQuery.data?.media_server ?? null; // "plex" | "jellyfin" | null
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [busy, setBusy] = useState(false);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["players"] });
    queryClient.invalidateQueries({ queryKey: ["state"] });
  }

  async function saveMapping(p: Player, raw: string) {
    const value = raw.trim() || null;
    const current = (server === "plex" ? p.plex_user : p.jellyfin_user) ?? null;
    if (!server || value === current) return;
    try {
      await withAdminPin(() => patchPlayer(p.id, {
        [server === "plex" ? "plex_user" : "jellyfin_user"]: value,
      }));
      invalidate();
    } catch {
      toast(S.common.writeFailed);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await withAdminPin(() => createPlayer({ name: name.trim(), emoji: emoji.trim() || null }));
      setName("");
      setEmoji("");
      invalidate();
    } catch (err) {
      toast(err instanceof ApiError && err.detail === "player_exists"
        ? S.settings.players.duplicate
        : S.common.writeFailed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    try {
      await withAdminPin(() => deactivatePlayer(id));
      invalidate();
    } catch {
      toast(S.common.writeFailed);
    }
  }

  const players = (playersQuery.data ?? []).filter(isActive);

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">{S.settings.players.title}</h3>
      {players.length === 0 ? (
        <p className="settings-empty">{S.settings.players.empty}</p>
      ) : (
        <ul className="settings-list">
          {players.map((p) => (
            <li key={p.id} className="settings-list__row">
              <span className="settings-list__name">
                {p.emoji ? `${p.emoji} ${p.name}` : p.name}
              </span>
              {server && (
                <label className="player-row__map">
                  <span className="player-row__map-label">
                    {server === "plex"
                      ? S.settings.players.plexUser
                      : S.settings.players.jellyfinUser}
                  </span>
                  <input
                    className="player-row__mapping"
                    type="text"
                    defaultValue={(server === "plex" ? p.plex_user : p.jellyfin_user) ?? ""}
                    aria-label={S.settings.players.mappingHint(
                      server === "plex" ? "Plex" : "Jellyfin")}
                    onBlur={(e) => saveMapping(p, e.currentTarget.value)}
                  />
                </label>
              )}
              <button type="button" className="btn-link" onClick={() => remove(p.id)}>
                <UserX size={16} aria-hidden="true" />
                {S.settings.players.deactivate}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="settings-form" onSubmit={add}>
        <input
          className="decade-select"
          placeholder={S.settings.players.namePlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="decade-select settings-form__emoji"
          placeholder={S.settings.players.emojiPlaceholder}
          value={emoji}
          maxLength={4}
          onChange={(e) => setEmoji(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
          <Plus size={16} aria-hidden="true" />
          {S.settings.players.add}
        </button>
      </form>
    </section>
  );
}

// --- Auto-log ---------------------------------------------------------------

const AUTOLOG_OFF_VALUES = new Set(["0", "false", "no", "off"]);

export function AutologSection() {
  const queryClient = useQueryClient();
  const healthQuery = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const connectionsQuery = useQuery({ queryKey: ["connections"], queryFn: getConnections });
  const raw = connectionsQuery.data?.autolog_enabled?.value ?? null;
  const on = raw === null || !AUTOLOG_OFF_VALUES.has(raw.toLowerCase());
  const hasServer = !!healthQuery.data?.media_server;

  async function toggle() {
    try {
      await withAdminPin(() => putConnections({ autolog_enabled: on ? "false" : "1" }));
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    } catch {
      toast(S.common.writeFailed);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">{S.settings.autolog.title}</h3>
      <p className="settings-section__caption">
        {hasServer ? S.settings.autolog.caption : S.settings.autolog.needsServer}
      </p>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={on}
          disabled={!hasServer || !!connectionsQuery.data?.autolog_enabled?.env}
          onChange={toggle}
        />
        {S.settings.autolog.title}
      </label>
    </section>
  );
}

/** The update phone-home's off switch (v1.10). Same env-first contract as
 * every other setting: env-set means the toggle is read-only here. */
function UpdateCheckCard({ data, onChanged }: {
  data: ConnectionsBundle | undefined;
  onChanged: () => void;
}) {
  const raw = data?.update_check?.value ?? null;
  const on = raw === null || !AUTOLOG_OFF_VALUES.has(raw.toLowerCase());
  const envLocked = !!data?.update_check?.env;

  async function toggle() {
    try {
      await withAdminPin(() => putConnections({ update_check: on ? "false" : "1" }));
      onChanged();
    } catch {
      toast(S.common.writeFailed);
    }
  }

  return (
    <div className="connection-card">
      <h4 className="connection-card__title">{S.settings.updateCheck.title}</h4>
      <p className="connection-card__hint">{S.settings.updateCheck.caption}</p>
      <label className="toggle-row">
        <input type="checkbox" checked={on} disabled={envLocked} onChange={toggle} />
        {S.settings.updateCheck.title}
        {envLocked && (
          <span className="connection-card__env-badge">{S.settings.envLocked}</span>
        )}
      </label>
    </div>
  );
}

// --- Pools -----------------------------------------------------------------

const STREAMS: Stream[] = ["movie", "tv"];

export function PoolsSection() {
  const queryClient = useQueryClient();
  const poolsQuery = useQuery({ queryKey: ["pools"], queryFn: listPools });
  const connectionsQuery = useQuery({ queryKey: ["connections"], queryFn: getConnections });
  const traktAvailable = !!connectionsQuery.data?.trakt_client_id?.value;
  const plexAvailable = !!connectionsQuery.data?.plex_url?.value;

  const [errors, setErrors] = useState<Record<number, string>>({});
  const [importResults, setImportResults] = useState<Record<number, string>>({});
  const [refreshing, setRefreshing] = useState<Record<number, boolean>>({});
  const [uploading, setUploading] = useState<Record<number, boolean>>({});

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["pools"] });
    queryClient.invalidateQueries({ queryKey: ["pool"] });
    queryClient.invalidateQueries({ queryKey: ["state"] });
  }

  async function refresh(id: number) {
    if (refreshing[id]) return;
    setRefreshing((m) => ({ ...m, [id]: true }));
    try {
      const r = await withAdminPin(() => refreshPool(id));
      if (r.ok === false) {
        setErrors((e) => ({ ...e, [id]: String(r.error ?? S.common.writeFailed) }));
      } else {
        setErrors((e) => {
          if (!(id in e)) return e;
          const next = { ...e };
          delete next[id];
          return next;
        });
      }
      invalidate();
    } catch {
      toast(S.common.writeFailed);
    } finally {
      setRefreshing((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
    }
  }

  async function activate(id: number) {
    try {
      await withAdminPin(() => activatePool(id));
      invalidate();
    } catch {
      toast(S.common.writeFailed);
    }
  }

  async function remove(id: number, name: string) {
    try {
      await withAdminPin(() => deletePool(id));
      toast(S.settings.pools.deleted(name));
      invalidate();
    } catch {
      toast(S.common.writeFailed);
    }
  }

  async function rename(id: number, name: string) {
    try {
      await withAdminPin(() => renamePool(id, name));
      toast(S.settings.pools.renamed(name));
      invalidate();
    } catch {
      toast(S.common.writeFailed);
    }
  }

  async function upload(id: number, file: File) {
    if (uploading[id]) return;
    setUploading((m) => ({ ...m, [id]: true }));
    try {
      const r = await withAdminPin(() => importPool(id, file));
      setImportResults((s) => ({
        ...s, [id]: S.settings.pools.importResult(r.imported, r.unresolved.length),
      }));
      invalidate();
    } catch {
      toast(S.common.writeFailed);
    } finally {
      setUploading((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
    }
  }

  const pools = poolsQuery.data ?? [];
  const [browsing, setBrowsing] = useState<PoolRow | null>(null);

  if (browsing) {
    return (
      <PoolBrowser pool={browsing} onBack={() => setBrowsing(null)} />
    );
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">{S.settings.pools.title}</h3>
      {STREAMS.map((stream) => (
        <PoolStreamPanel
          key={stream}
          stream={stream}
          pools={pools.filter((p) => p.media_type === stream)}
          traktAvailable={traktAvailable}
          plexAvailable={plexAvailable}
          errors={errors}
          importResults={importResults}
          refreshing={refreshing}
          uploading={uploading}
          onRefresh={refresh}
          onActivate={activate}
          onDelete={remove}
          onRename={rename}
          onBrowse={setBrowsing}
          onUpload={upload}
          onCreated={invalidate}
        />
      ))}
    </section>
  );
}

/** The pool's full list with room-wide seen check-offs. Checking posts a
 * 'seen' event as the signed-in player; un-checking posts 'unseen' (the
 * latest event wins server-side). Game actions — never PIN-gated. */
function PoolBrowser({ pool, onBack }: { pool: PoolRow; onBack: () => void }) {
  const { playerId } = useSession();
  const queryClient = useQueryClient();
  const itemsQuery = useQuery({
    queryKey: ["pool-items", pool.id],
    queryFn: () => getPoolItems(pool.id),
  });
  const stateQuery = useQuery({ queryKey: ["state"], queryFn: getState });
  const [search, setSearch] = useState("");
  // Optimistic overrides layered over the server's seen set; the state
  // refetch after each toggle agrees with them, so they never go stale.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const items = itemsQuery.data ?? [];
  const seenSet = new Set(stateQuery.data?.seen?.[pool.media_type] ?? []);
  const isSeen = (key: string) => overrides[key] ?? seenSet.has(key);
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? items.filter((it) => it.title.toLowerCase().includes(needle))
    : items;
  const seenCount = items.filter((it) => isSeen(it.item_key)).length;

  async function toggle(it: PoolItem) {
    if (playerId == null) return;
    const next = !isSeen(it.item_key);
    setOverrides((o) => ({ ...o, [it.item_key]: next }));
    try {
      await postEvent({
        player: playerId,
        media_type: pool.media_type,
        item_key: it.item_key,
        title: it.title,
        year: it.year,
        action: next ? "seen" : "unseen",
      });
      queryClient.invalidateQueries({ queryKey: ["state"] });
    } catch {
      setOverrides((o) => ({ ...o, [it.item_key]: !next }));
      toast(S.settings.pools.markSeenFailed);
    }
  }

  return (
    <section className="settings-section">
      <button type="button" className="btn-link pool-browser__back" onClick={onBack}>
        {S.settings.pools.back}
      </button>
      <div className="pool-browser__head">
        <h3 className="settings-section__title">{pool.name}</h3>
        <span className="pool-row__meta">
          {S.settings.pools.browserCounts(seenCount, items.length)}
        </span>
      </div>
      <input
        className="decade-select pool-browser__search"
        placeholder={S.settings.pools.searchPlaceholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {shown.length === 0 ? (
        <p className="settings-empty">
          {items.length === 0 ? S.settings.pools.noneYet : S.settings.pools.noMatches}
        </p>
      ) : (
        <ul className="settings-list pool-browser__list">
          {shown.map((it) => (
            <li key={it.item_key} className="pool-browser__row">
              <label className="pool-browser__label">
                <input
                  type="checkbox"
                  checked={isSeen(it.item_key)}
                  onChange={() => toggle(it)}
                />
                <span className="pool-browser__title">
                  {it.title}
                  {it.year != null && (
                    <span className="pool-browser__year"> ({it.year})</span>
                  )}
                </span>
                {it.runtime != null && (
                  <span className="pool-row__meta">{it.runtime}m</span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PoolStreamPanel({
  stream, pools, traktAvailable, plexAvailable, errors, importResults, refreshing, uploading, onRefresh, onActivate, onDelete, onRename, onBrowse, onUpload, onCreated,
}: {
  stream: Stream;
  pools: PoolRow[];
  traktAvailable: boolean;
  plexAvailable: boolean;
  errors: Record<number, string>;
  importResults: Record<number, string>;
  refreshing: Record<number, boolean>;
  uploading: Record<number, boolean>;
  onRefresh: (id: number) => void;
  onActivate: (id: number) => void;
  onDelete: (id: number, name: string) => void;
  onRename: (id: number, name: string) => void;
  onBrowse: (pool: PoolRow) => void;
  onUpload: (id: number, file: File) => void;
  onCreated: () => void;
}) {
  // One row renames at a time; Enter/blur commits, Escape abandons.
  const [renamingId, setRenamingId] = useState<number | null>(null);

  function commitRename(p: PoolRow, raw: string) {
    setRenamingId(null);
    const next = raw.trim();
    if (next && next !== p.name) onRename(p.id, next);
  }
  const [name, setName] = useState("");
  const [source, setSource] = useState<"custom" | "tmdb" | "trakt" | "plex">("custom");
  const [listId, setListId] = useState("");
  const [plexSections, setPlexSections] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Delete is two-tap: first arms, second fires; blur or 5s disarms.
  const [armedId, setArmedId] = useState<number | null>(null);
  useEffect(() => {
    if (armedId === null) return;
    const t = window.setTimeout(() => setArmedId(null), 5000);
    return () => window.clearTimeout(t);
  }, [armedId]);

  // Only fetched once someone actually picks the Plex source.
  const sectionsQuery = useQuery({
    queryKey: ["plex-sections"],
    queryFn: getPlexSections,
    enabled: source === "plex",
  });
  const wantType = stream === "movie" ? "movie" : "show";
  const matchingSections =
    (sectionsQuery.data?.sections ?? []).filter((s) => s.type === wantType);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const config = source === "custom" ? {}
        : source === "plex" ? { sections: plexSections }
        : { list_id: listId.trim() };
      await withAdminPin(() => createPool({ name: name.trim(), media_type: stream, source, config }));
      setName("");
      setListId("");
      setPlexSections([]);
      onCreated();
    } catch {
      toast(S.common.writeFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pool-stream-panel">
      <h4 className="pool-stream-panel__title">
        {stream === "movie" ? S.streams.movie : S.streams.tv}
      </h4>

      {pools.length === 0 ? (
        <p className="settings-empty">{S.settings.pools.noneYet}</p>
      ) : (
        <ul className="settings-list">
          {pools.map((p) => (
            <li key={p.id} className="pool-row">
              <div className="pool-row__header">
                {renamingId === p.id ? (
                  <input
                    className="decade-select pool-row__rename"
                    defaultValue={p.name}
                    aria-label={S.settings.pools.rename(p.name)}
                    autoFocus
                    onBlur={(e) => commitRename(p, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        e.currentTarget.value = p.name;
                        e.currentTarget.blur();
                      }
                    }}
                  />
                ) : (
                  <>
                    <span className="pool-row__name">{p.name}</span>
                    <button
                      type="button"
                      className="btn-link pool-row__edit"
                      aria-label={S.settings.pools.rename(p.name)}
                      onClick={() => setRenamingId(p.id)}
                    >
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                  </>
                )}
                {!!p.active && <span className="pool-row__badge">{S.settings.pools.active}</span>}
                <span className="pool-row__meta">
                  {p.refreshed_at
                    ? S.settings.pools.refreshedAt(formatWhen(p.refreshed_at))
                    : S.settings.pools.neverRefreshed}
                  {" · "}
                  {S.settings.pools.itemCount(p.item_count)}
                </span>
              </div>
              {errors[p.id] && (
                <p className="pool-row__error">{S.settings.pools.lastError(errors[p.id])}</p>
              )}
              {importResults[p.id] && <p className="pool-row__note">{importResults[p.id]}</p>}
              <div className="pool-row__actions">
                <button type="button" className="btn-secondary" onClick={() => onBrowse(p)}>
                  <List size={14} aria-hidden="true" />
                  {S.settings.pools.viewList}
                </button>
                <button
                  type="button"
                  className={
                    "btn-secondary" +
                    (refreshing[p.id] ? " pool-row__refresh--busy" : "")
                  }
                  disabled={!!refreshing[p.id]}
                  aria-busy={!!refreshing[p.id]}
                  onClick={() => onRefresh(p.id)}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {S.settings.pools.refresh}
                </button>
                {!p.active && (
                  <button type="button" className="btn-secondary" onClick={() => onActivate(p.id)}>
                    {S.settings.pools.activate}
                  </button>
                )}
                {p.source === "custom" && (
                  <label
                    className={
                      "btn-link pool-row__upload" +
                      (uploading[p.id] ? " pool-row__upload--busy" : "")
                    }
                    aria-busy={!!uploading[p.id]}
                  >
                    <Upload size={14} aria-hidden="true" />
                    {uploading[p.id]
                      ? S.settings.pools.importing
                      : S.settings.pools.uploadFile}
                    <input
                      type="file"
                      accept=".csv,.json,.txt"
                      className="visually-hidden"
                      disabled={!!uploading[p.id]}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUpload(p.id, file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
                {!p.active && (
                  <button
                    type="button"
                    className={
                      "btn-link pool-row__delete" +
                      (armedId === p.id ? " pool-row__delete--armed" : "")
                    }
                    onClick={() => {
                      if (armedId === p.id) {
                        setArmedId(null);
                        onDelete(p.id, p.name);
                      } else {
                        setArmedId(p.id);
                      }
                    }}
                    onBlur={() => setArmedId((a) => (a === p.id ? null : a))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {armedId === p.id
                      ? S.settings.pools.deleteArmed(p.item_count)
                      : S.settings.pools.delete}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="settings-form" onSubmit={create}>
        <input
          className="decade-select"
          placeholder={S.settings.pools.namePlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="decade-select"
          value={source}
          onChange={(e) => setSource(e.target.value as "custom" | "tmdb" | "trakt" | "plex")}
        >
          <option value="custom">{S.settings.pools.sourceCustom}</option>
          <option value="tmdb">{S.settings.pools.sourceTmdb}</option>
          {traktAvailable && <option value="trakt">{S.settings.pools.sourceTrakt}</option>}
          {plexAvailable && <option value="plex">{S.settings.pools.sourcePlex}</option>}
        </select>
        {(source === "tmdb" || source === "trakt") && (
          <input
            className="decade-select"
            placeholder={S.settings.pools.listId}
            value={listId}
            onChange={(e) => setListId(e.target.value)}
          />
        )}
        {source === "plex" && (
          <div className="pool-plex-sections">
            <div className="console__label">{S.settings.pools.plexSections}</div>
            {matchingSections.length === 0 ? (
              <p className="settings-empty">{S.settings.pools.plexNoSections}</p>
            ) : (
              matchingSections.map((s) => (
                <label key={s.key} className="toggle-row">
                  <input
                    type="checkbox"
                    checked={plexSections.includes(s.key)}
                    onChange={(e) =>
                      setPlexSections((cur) => e.target.checked
                        ? [...cur, s.key]
                        : cur.filter((k) => k !== s.key))}
                  />
                  {s.title}
                </label>
              ))
            )}
          </div>
        )}
        <button
          type="submit"
          className="btn-primary"
          disabled={busy || !name.trim() || (source === "plex" && plexSections.length === 0)}
        >
          <Plus size={16} aria-hidden="true" />
          {S.settings.pools.create}
        </button>
      </form>
    </div>
  );
}

// --- Connections -------------------------------------------------------

interface ServiceField {
  key: string;
  label: string;
  type: "text" | "password";
}

interface ServiceDef {
  service: string;
  label: string;
  fields: ServiceField[];
}

const SERVICES: ServiceDef[] = [
  { service: "seerr", label: S.settings.connections.services.seerr, fields: [
    { key: "seerr_url", label: S.settings.connections.urlLabel, type: "text" },
    { key: "seerr_api_key", label: S.settings.connections.keyLabel, type: "password" },
  ] },
  { service: "radarr", label: S.settings.connections.services.radarr, fields: [
    { key: "radarr_url", label: S.settings.connections.urlLabel, type: "text" },
    { key: "radarr_api_key", label: S.settings.connections.keyLabel, type: "password" },
  ] },
  { service: "sonarr", label: S.settings.connections.services.sonarr, fields: [
    { key: "sonarr_url", label: S.settings.connections.urlLabel, type: "text" },
    { key: "sonarr_api_key", label: S.settings.connections.keyLabel, type: "password" },
  ] },
  { service: "tmdb", label: S.settings.connections.services.tmdb, fields: [
    { key: "tmdb_api_key", label: S.settings.connections.keyLabel, type: "password" },
  ] },
  { service: "trakt", label: S.settings.connections.services.trakt, fields: [
    { key: "trakt_client_id", label: S.settings.connections.clientIdLabel, type: "text" },
  ] },
  { service: "plex", label: S.settings.connections.services.plex, fields: [
    { key: "plex_url", label: S.settings.connections.urlLabel, type: "text" },
    { key: "plex_token", label: S.settings.connections.tokenLabel, type: "password" },
  ] },
  { service: "jellyfin", label: S.settings.connections.services.jellyfin, fields: [
    { key: "jellyfin_url", label: S.settings.connections.urlLabel, type: "text" },
    { key: "jellyfin_api_key", label: S.settings.connections.keyLabel, type: "password" },
  ] },
];

type TestResult = "testing" | { ok: boolean; message: string };

export function ConnectionsSection() {
  const queryClient = useQueryClient();
  const connectionsQuery = useQuery({ queryKey: ["connections"], queryFn: getConnections });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const data = connectionsQuery.data;

  function fieldValue(key: string): string {
    if (drafts[key] !== undefined) return drafts[key];
    return data?.[key]?.value ?? "";
  }

  async function save(svc: ServiceDef) {
    const body: Record<string, string> = {};
    for (const f of svc.fields) {
      if (drafts[f.key] !== undefined) body[f.key] = drafts[f.key];
    }
    if (Object.keys(body).length === 0) return;
    try {
      await withAdminPin(() => putConnections(body));
      toast(S.settings.connections.saved);
      setDrafts((d) => {
        const next = { ...d };
        for (const f of svc.fields) delete next[f.key];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    } catch {
      toast(S.common.writeFailed);
    }
  }

  async function test(svc: ServiceDef) {
    setTestResults((s) => ({ ...s, [svc.service]: "testing" }));
    try {
      const r = await withAdminPin(() => testConnection(svc.service));
      setTestResults((s) => ({ ...s, [svc.service]: r }));
    } catch (e) {
      // withAdminPin surfaces PIN outcomes as internal tokens, not
      // human-readable copy — map each to its own friendly string (a
      // cancelled prompt and a wrong PIN are different situations and must
      // not be conflated), falling back to any other detail as-is.
      const message = e instanceof ApiError ? pinAwareMessage(e.detail) : S.settings.connectionTest.fail;
      setTestResults((s) => ({
        ...s,
        [svc.service]: { ok: false, message },
      }));
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">{S.settings.connections.title}</h3>
      {SERVICES.map((svc) => {
        const result = testResults[svc.service];
        return (
          <div key={svc.service} className="connection-card">
            <h4 className="connection-card__title">{svc.label}</h4>
            {svc.fields.map((f) => {
              const conn = data?.[f.key];
              const envLocked = !!conn?.env;
              return (
                <label key={f.key} className="connection-card__field">
                  <span className="connection-card__field-label">{f.label}</span>
                  <input
                    className="decade-select"
                    type={f.type}
                    value={fieldValue(f.key)}
                    disabled={envLocked}
                    onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                  {envLocked && (
                    <span className="connection-card__env-badge">{S.settings.envLocked}</span>
                  )}
                </label>
              );
            })}
            <div className="connection-card__actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={result === "testing"}
                onClick={() => test(svc)}
              >
                {result === "testing" ? S.settings.connectionTest.testing : S.settings.connections.test}
              </button>
              <button type="button" className="btn-primary" onClick={() => save(svc)}>
                {S.common.save}
              </button>
            </div>
            {result && result !== "testing" && (
              result.ok ? (
                <span className="connection-card__test connection-card__test--ok">
                  <Check size={14} aria-hidden="true" />
                  {S.settings.connectionTest.ok}
                </span>
              ) : (
                <span className="connection-card__test connection-card__test--fail">
                  {result.message || S.settings.connectionTest.fail}
                </span>
              )
            )}
          </div>
        );
      })}
      <MediaServerCard
        data={data}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ["connections"] });
          queryClient.invalidateQueries({ queryKey: ["health"] });
        }}
      />
      <UpdateCheckCard
        data={data}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ["connections"] });
          queryClient.invalidateQueries({ queryKey: ["update"] });
        }}
      />
    </section>
  );
}

/** Picks which media server (if any) is the availability source and auto-log
 * playback origin. This is the ONLY control that writes the `media_server`
 * setting — saving Plex/Jellyfin credentials never activates a backend on its
 * own. Admin-gated like the rest of Connections; read-only when MEDIA_SERVER
 * is env-set (invariant 11). */
function MediaServerCard({ data, onChanged }: {
  data: ConnectionsBundle | undefined;
  onChanged: () => void;
}) {
  const conn = data?.media_server;
  const envLocked = !!conn?.env;
  const current = conn?.value ?? "";
  const [saving, setSaving] = useState(false);

  async function change(value: string) {
    if (value === current) return;
    setSaving(true);
    try {
      await withAdminPin(() => putConnections({ media_server: value }));
      toast(S.settings.connections.saved);
      onChanged();
    } catch {
      toast(S.common.writeFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="connection-card">
      <h4 className="connection-card__title">{S.settings.connections.mediaServer.title}</h4>
      <p className="connection-card__hint">{S.settings.connections.mediaServer.hint}</p>
      <label className="connection-card__field">
        <span className="connection-card__field-label">
          {S.settings.connections.mediaServer.label}
        </span>
        <select
          className="decade-select"
          value={current}
          disabled={envLocked || saving}
          onChange={(e) => change(e.target.value)}
        >
          <option value="">{S.settings.connections.mediaServer.none}</option>
          <option value="plex">Plex</option>
          <option value="jellyfin">Jellyfin</option>
        </select>
      </label>
      {current === "plex" && <BackfillRow />}
      {envLocked && (
        <span className="connection-card__env-badge">{S.settings.envLocked}</span>
      )}
    </div>
  );
}

/** One-tap, re-runnable seen-backfill (v1.2.3). Only rendered when Plex is
 * the active media server — the backend's watched_keys seam is Plex-only
 * for now. Result line reports marked/skipped so re-runs read as no-ops. */
function BackfillRow() {
  const { playerId } = useSession();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    if (playerId == null) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await withAdminPin(() => backfillSeen(playerId));
      setResult(r.ok
        ? S.settings.backfill.result(r.marked_movies, r.marked_tv, r.skipped_seen)
        : r.message ?? S.settings.backfill.failed);
      if (r.ok) {
        // seen changed -> the wheel's eligible count and state must refresh
        queryClient.invalidateQueries({ queryKey: ["state"] });
      }
    } catch (e) {
      setResult(e instanceof ApiError ? pinAwareMessage(e.detail) : S.settings.backfill.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connection-card__field">
      <button type="button" className="btn-secondary" disabled={busy} onClick={run}>
        {busy ? S.settings.backfill.running : S.settings.backfill.button}
      </button>
      {result && <span className="connection-card__env-badge">{result}</span>}
    </div>
  );
}

// --- Settings (assembled view) ------------------------------------------

// The Back Office: one section on stage at a time, picked from a rail
// (desktop) or a chip row (mobile). Plain state, same as App's views.
type SettingsSection = "players" | "pools" | "autolog" | "connections";

const SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: "players", label: S.settings.nav.players },
  { key: "pools", label: S.settings.nav.pools },
  { key: "autolog", label: S.settings.nav.autolog },
  { key: "connections", label: S.settings.nav.connections },
];

export function Settings() {
  const [section, setSection] = useState<SettingsSection>("players");
  const healthQuery = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const version = healthQuery.data?.version;
  const updateQuery = useQuery({
    queryKey: ["update"], queryFn: getUpdate, staleTime: 12 * 3600 * 1000,
  });
  const update = updateQuery.data;

  return (
    <div className="settings-view">
      <nav className="settings-rail" aria-label={S.settings.title}>
        <ul className="settings-rail__list">
          {SECTIONS.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className={
                  "settings-rail__link" +
                  (section === s.key ? " settings-rail__link--active" : "")
                }
                aria-current={section === s.key ? "true" : undefined}
                onClick={() => setSection(s.key)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
        {version && (
          <p className="settings-rail__version">
            v{version}
            {update?.update_available && update.latest && (
              <a
                className="settings-rail__update"
                href="https://github.com/decidarr/decidarr/releases"
                target="_blank"
                rel="noreferrer"
              >
                {S.settings.updateAvailable(update.latest)}
              </a>
            )}
          </p>
        )}
      </nav>
      <div className="settings-content">
        {section === "players" && <PlayersSection />}
        {section === "autolog" && <AutologSection />}
        {section === "pools" && <PoolsSection />}
        {section === "connections" && <ConnectionsSection />}
        <p className="settings-footer">{S.attribution.tmdb}</p>
      </div>
    </div>
  );
}
