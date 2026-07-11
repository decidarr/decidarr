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

  // Run once the document is loaded — but if this module evaluated AFTER
  // the load event already fired (a fast reload can beat the listener),
  // a plain window "load" listener would never run and the waiting-worker
  // check below would be skipped, making the update toast unreachable in
  // exactly the scenario it exists for. So dispatch immediately when the
  // document is already complete.
  if (document.readyState === "complete") {
    void onLoad();
  } else {
    window.addEventListener("load", () => void onLoad(), { once: true });
  }

  function onLoad(): void {
    const base = import.meta.env.BASE_URL;
    const swUrl = `${base}sw.js`;

    navigator.serviceWorker
      .register(swUrl, { scope: base })
      .then((registration) => {
        let prompted = false;
        const promptReload = (worker: ServiceWorker) => {
          if (prompted) return; // one prompt per waiting update
          prompted = true;
          toast(S.pwa.updateAvailable, {
            actionLabel: S.pwa.reload,
            // Stays up until the player acts — an update prompt that
            // vanishes after 3s defeats the point of the invariant.
            ttl: 24 * 60 * 60 * 1000,
            onAction: () => worker.postMessage({ type: "SKIP_WAITING" }),
          });
        };

        // Track a worker to installed-with-controller (= an update ready to
        // take over, not the very first install). The browser starts the
        // update check on navigation, often BEFORE this code runs, so by the
        // time we get here the new worker may already be "installing" (miss
        // the updatefound event) or already "waiting" — cover all three:
        // already-waiting, mid-install, and future updates.
        const track = (worker: ServiceWorker | null) => {
          if (!worker) return;
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            promptReload(worker);
            return;
          }
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              promptReload(worker);
            }
          });
        };

        if (registration.waiting && navigator.serviceWorker.controller) {
          promptReload(registration.waiting); // installed before we arrived
        }
        track(registration.installing); // update already in flight
        registration.addEventListener("updatefound", () => track(registration.installing));
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
  }
}
