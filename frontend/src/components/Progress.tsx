// Progress watcher: polls /api/progress every 5s for a single in-flight
// pick. Exactly one watcher exists per mounted <Progress/> — it's a plain
// child of one card, so React's own unmount lifecycle tears the interval
// down (no manual bookkeeping needed across cards, unlike Swamp Roulette).
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { getConnections, getProgress } from "../api";
import {
  PROGRESS_POLL_CAP,
  PROGRESS_POLL_MS,
  progressDisplay,
} from "../logic";
import { S } from "../strings";
import type { Progress as ProgressData, Stream } from "../types";

interface ProgressProps {
  stream: Stream;
  tmdb_id?: number | null;
  tvdb_id?: number | null;
  title: string;
  year?: number | null;
  /** Fired once when the watcher first observes `state === "done"` — lets
   * a parent (TonightCard) drop the stale "pending" status it had cached
   * and re-probe /api/status instead of waiting for its own poll cycle. */
  onDone?: () => void;
}

export function Progress({ stream, tmdb_id, tvdb_id, title, year, onDone }: ProgressProps) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const pollCountRef = useRef(0);
  const searchingSinceRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const doneFiredRef = useRef(false);

  const stopInterval = () => {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const poll = useCallback(async () => {
    if (pollCountRef.current >= PROGRESS_POLL_CAP) {
      stopInterval();
      return;
    }
    pollCountRef.current += 1;
    try {
      const p = await getProgress({
        type: stream,
        tmdb: tmdb_id ?? undefined,
        tvdb: tvdb_id ?? undefined,
        title,
        year: year ?? undefined,
      });
      searchingSinceRef.current =
        p.state === "searching" ? (searchingSinceRef.current ?? Date.now()) : null;
      setProgress(p);
      if (p.state === "done" && !doneFiredRef.current) {
        doneFiredRef.current = true;
        onDone?.();
      }
      if (pollCountRef.current >= PROGRESS_POLL_CAP) stopInterval();
      // "done" is a terminal state server-side (first episode/file
      // imported) — nothing left to poll for.
      if (p.state === "done") stopInterval();
    } catch {
      // The progress endpoint never 5xx's for config/connectivity
      // (invariant #1); a network blip here just skips this tick — the
      // interval keeps going and tries again in PROGRESS_POLL_MS.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, tmdb_id, tvdb_id, title, year]);

  // Mount: first poll immediately, then every PROGRESS_POLL_MS.
  useEffect(() => {
    pollCountRef.current = 0;
    searchingSinceRef.current = null;
    doneFiredRef.current = false;
    poll();
    intervalRef.current = window.setInterval(poll, PROGRESS_POLL_MS);
    return stopInterval;
  }, [poll]);

  // Pause while the tab is hidden, resume (with an immediate poll) on
  // visibility/focus — a poll-count reset is NOT desired here, the cap is
  // wall-clock-of-actual-polls, not calendar time.
  useEffect(() => {
    function onVisible() {
      if (document.hidden) {
        stopInterval();
      } else if (intervalRef.current == null && pollCountRef.current < PROGRESS_POLL_CAP) {
        poll();
        intervalRef.current = window.setInterval(poll, PROGRESS_POLL_MS);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [poll]);

  const display = progress
    ? progressDisplay(progress, stream, {
        searchingMs: searchingSinceRef.current != null ? Date.now() - searchingSinceRef.current : 0,
        pollCount: pollCountRef.current,
      })
    : ({ kind: "hidden" } as const);

  // Only fetch the Seerr base URL once we actually need to link to it —
  // GET /api/connections is unauthenticated but there's no reason to call
  // it on every mount.
  const connQuery = useQuery({
    queryKey: ["connections"],
    queryFn: getConnections,
    enabled: display.kind === "stuck",
    staleTime: 5 * 60 * 1000,
  });

  if (display.kind === "hidden") return null;

  const seerrUrl = connQuery.data?.seerr_url?.value;
  const seerrHref =
    display.kind === "stuck" && seerrUrl && tmdb_id != null
      ? `${seerrUrl.replace(/\/$/, "")}/${stream === "tv" ? "tv" : "movie"}/${tmdb_id}`
      : null;

  return (
    <div className="progress" aria-live="polite">
      {display.kind === "bar" && (
        <div className="progress-bar">
          <div className="progress-bar__track">
            <div
              className="progress-bar__fill"
              style={{ width: `${Math.max(0, Math.min(100, display.percent))}%` }}
            />
          </div>
          <p className="progress__label">
            {display.label}
            {display.eta ? ` · ${display.eta}` : ""}
          </p>
        </div>
      )}

      {display.kind === "label" && <p className="progress__label">{display.text}</p>}

      {display.kind === "done" && <p className="progress__done">{display.text}</p>}

      {(display.kind === "stuck" || display.kind === "capped") && (
        <div className="progress__stuck">
          <p className="progress__label">{display.text}</p>
          {seerrHref && (
            <a
              className="progress__seerr-link"
              href={seerrHref}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} aria-hidden="true" />
              {S.progress.seerrLink}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
