import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { toast } from "./components/Toast";
import { S } from "./strings";
import "./tokens.css";
import "./app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();

/**
 * PWA install layer: registers the shell service worker with a scope that
 * follows `BASE_URL`, so a subpath deploy (URL_BASE=/decidarr/) gets a
 * service worker scoped to /decidarr/ rather than clashing with anything
 * at the root. Note this intentionally does NOT use
 * `new URL("sw.js", import.meta.env.BASE_URL)` — BASE_URL is a path
 * ("/" or "/decidarr/"), not an absolute URL, and the URL constructor's
 * base argument must be absolute or it throws. A root-relative
 * registration string plus an explicit `scope` option is the working
 * equivalent.
 *
 * Update flow: sw.js caches the shell cache-first and never touches
 * /api. When a new build ships, the browser installs a new worker that
 * sits "waiting" behind the active one. We detect that waiting worker and
 * raise a toast (via the existing Toast host) whose action posts
 * {type: "SKIP_WAITING"} to it — the worker then calls self.skipWaiting()
 * and takes over, firing "controllerchange", at which point we reload.
 * Without this, a cache-first shell would otherwise pin players to a
 * stale build indefinitely.
 */
function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    const swUrl = `${base}sw.js`;

    navigator.serviceWorker
      .register(swUrl, { scope: base })
      .then((registration) => {
        const promptReload = (worker: ServiceWorker) => {
          toast(S.pwa.updateAvailable, {
            actionLabel: S.pwa.reload,
            // Stays up until the player acts — an update prompt that
            // vanishes after 3s defeats the point of the invariant.
            ttl: 24 * 60 * 60 * 1000,
            onAction: () => worker.postMessage({ type: "SKIP_WAITING" }),
          });
        };

        // An update may already be waiting from a previous visit.
        if (registration.waiting && navigator.serviceWorker.controller) {
          promptReload(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // "installed" + an existing controller means this is an
            // update, not the very first install — only prompt then.
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              promptReload(installing);
            }
          });
        });
      })
      .catch(() => {
        // Installability is a progressive enhancement — never block the app.
      });

    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}
