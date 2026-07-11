// Decidarr service worker — cache-first APP SHELL ONLY, network-only for
// /api. Registered from src/main.tsx with a scope derived from
// import.meta.env.BASE_URL, so every path here (all relative, resolved
// against this script's own URL) automatically lands under a subpath
// deploy without any hardcoded prefix.
//
// Update flow: a new SW installs alongside the active one and waits.
// main.tsx listens for that waiting worker and raises a toast; the toast's
// action posts {type: "SKIP_WAITING"} (handled below) which activates the
// new SW immediately, then main.tsx reloads on "controllerchange". This is
// what stops a cached shell from pinning a player to a stale build.
// The SHELL cache name below ends in a placeholder token that
// scripts/stamp-sw.mjs (run via the npm "build" script) rewrites at build
// time with a hash of the content-hashed dist asset filenames. This makes
// sw.js byte-different whenever the app content changes, which is the ONLY
// thing that makes the browser run its SW update algorithm (→ updatefound
// → registration.waiting → the "new version — reload?" toast in
// main.tsx). A static literal would ship identical bytes every deploy and
// the update toast would never fire, pinning users to a stale cached shell.
const SHELL = "decidarr-shell-__BUILD_HASH__";
const PRECACHE = ["./", "./index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  // Drop every prior shell cache so a new build's stamped SHELL never
  // leaves the old content-hashed assets orphaned in storage.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("decidarr-shell-") && k !== SHELL)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // never intercept mutations

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // same-origin shell only
  if (url.pathname.includes("/api/")) return; // network-only for the API

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          // Only cache successful, basic (same-origin, non-opaque) responses.
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
