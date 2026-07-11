// Admin settings: Players, Pools, Connections. Each section is exported
// standalone so Onboarding can mount the same components inline as wizard
// steps — the wizard is just an ordered path through these, not a fork.
import { useState } from "react";
import type { FormEvent } from "react";
import { Check, Plus, RefreshCw, Upload, UserX } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ApiError, activatePool, createPlayer, createPool, deactivatePlayer,
  getConnections, importPool, listPlayers, listPools, putConnections,
  refreshPool, testConnection,
} from "../api";
import type { PoolRow } from "../api";
import { formatWhen } from "../logic";
import { S } from "../strings";
import { toast } from "./Toast";
import { withAdminPin } from "./AdminPin";
import type { Player, Stream } from "../types";

export function isActive(p: Player): boolean {
  return p.active === 1 || p.active === true || p.active === undefined;
}

// --- Players --------------------------------------------------------------

export function PlayersSection() {
  const queryClient = useQueryClient();
  const playersQuery = useQuery({ queryKey: ["players"], queryFn: listPlayers });
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [busy, setBusy] = useState(false);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["players"] });
    queryClient.invalidateQueries({ queryKey: ["state"] });
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
              <span>{p.emoji ? `${p.emoji} ${p.name}` : p.name}</span>
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

// --- Pools -----------------------------------------------------------------

const STREAMS: Stream[] = ["movie", "tv"];

export function PoolsSection() {
  const queryClient = useQueryClient();
  const poolsQuery = useQuery({ queryKey: ["pools"], queryFn: listPools });
  const connectionsQuery = useQuery({ queryKey: ["connections"], queryFn: getConnections });
  const traktAvailable = !!connectionsQuery.data?.trakt_client_id?.value;

  const [errors, setErrors] = useState<Record<number, string>>({});
  const [importResults, setImportResults] = useState<Record<number, string>>({});

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["pools"] });
    queryClient.invalidateQueries({ queryKey: ["pool"] });
    queryClient.invalidateQueries({ queryKey: ["state"] });
  }

  async function refresh(id: number) {
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

  async function upload(id: number, file: File) {
    try {
      const r = await withAdminPin(() => importPool(id, file));
      setImportResults((s) => ({
        ...s, [id]: S.settings.pools.importResult(r.imported, r.unresolved.length),
      }));
      invalidate();
    } catch {
      toast(S.common.writeFailed);
    }
  }

  const pools = poolsQuery.data ?? [];

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">{S.settings.pools.title}</h3>
      {STREAMS.map((stream) => (
        <PoolStreamPanel
          key={stream}
          stream={stream}
          pools={pools.filter((p) => p.media_type === stream)}
          traktAvailable={traktAvailable}
          errors={errors}
          importResults={importResults}
          onRefresh={refresh}
          onActivate={activate}
          onUpload={upload}
          onCreated={invalidate}
        />
      ))}
    </section>
  );
}

function PoolStreamPanel({
  stream, pools, traktAvailable, errors, importResults, onRefresh, onActivate, onUpload, onCreated,
}: {
  stream: Stream;
  pools: PoolRow[];
  traktAvailable: boolean;
  errors: Record<number, string>;
  importResults: Record<number, string>;
  onRefresh: (id: number) => void;
  onActivate: (id: number) => void;
  onUpload: (id: number, file: File) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<"custom" | "tmdb" | "trakt">("custom");
  const [listId, setListId] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const config = source === "custom" ? {} : { list_id: listId.trim() };
      await withAdminPin(() => createPool({ name: name.trim(), media_type: stream, source, config }));
      setName("");
      setListId("");
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
                <span className="pool-row__name">{p.name}</span>
                {!!p.active && <span className="pool-row__badge">{S.settings.pools.active}</span>}
              </div>
              <p className="pool-row__meta">
                {p.refreshed_at
                  ? S.settings.pools.refreshedAt(formatWhen(p.refreshed_at))
                  : S.settings.pools.neverRefreshed}
                {" · "}
                {S.settings.pools.itemCount(p.item_count)}
              </p>
              {errors[p.id] && (
                <p className="pool-row__error">{S.settings.pools.lastError(errors[p.id])}</p>
              )}
              {importResults[p.id] && <p className="pool-row__meta">{importResults[p.id]}</p>}
              <div className="pool-row__actions">
                <button type="button" className="btn-secondary" onClick={() => onRefresh(p.id)}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {S.settings.pools.refresh}
                </button>
                {!p.active && (
                  <button type="button" className="btn-secondary" onClick={() => onActivate(p.id)}>
                    {S.settings.pools.activate}
                  </button>
                )}
                {p.source === "custom" && (
                  <label className="btn-link pool-row__upload">
                    <Upload size={14} aria-hidden="true" />
                    {S.settings.pools.uploadFile}
                    <input
                      type="file"
                      accept=".csv,.json,.txt"
                      className="visually-hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUpload(p.id, file);
                        e.target.value = "";
                      }}
                    />
                  </label>
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
          onChange={(e) => setSource(e.target.value as "custom" | "tmdb" | "trakt")}
        >
          <option value="custom">{S.settings.pools.sourceCustom}</option>
          <option value="tmdb">{S.settings.pools.sourceTmdb}</option>
          {traktAvailable && <option value="trakt">{S.settings.pools.sourceTrakt}</option>}
        </select>
        {source !== "custom" && (
          <input
            className="decade-select"
            placeholder={S.settings.pools.listId}
            value={listId}
            onChange={(e) => setListId(e.target.value)}
          />
        )}
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
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
      // A cancelled admin-PIN prompt re-throws ApiError{detail:"admin_pin_required"}
      // — that's an internal token, not a human-readable message, so it needs
      // its own friendly copy rather than being rendered raw.
      const message = e instanceof ApiError
        ? (e.detail === "admin_pin_required" ? S.settings.pinCancelled : e.detail)
        : S.settings.connectionTest.fail;
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
    </section>
  );
}

// --- Settings (assembled view) ------------------------------------------

export function Settings() {
  return (
    <div className="settings-view">
      <PlayersSection />
      <PoolsSection />
      <ConnectionsSection />
      <p className="settings-footer">{S.attribution.tmdb}</p>
    </div>
  );
}
