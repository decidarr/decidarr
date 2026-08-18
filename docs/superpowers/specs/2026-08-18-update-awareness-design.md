# Update awareness (v1.10.0)

Tim: users need a way to update to the latest version. For a
Docker-deployed app the honest feature is notification, not
self-update — a container can't replace its own image, and Docker-socket
access from the app is a security hole (the *arr precedent: notice
only when containerized). Design approved 2026-08-18.

## Backend

- `updates.py`: fetch the newest published version from Docker Hub's
  public tags API (`hub.docker.com/v2/repositories/decidarr/decidarr/tags`)
  — the registry reflects what can actually be pulled, truer than git
  tags. Highest semver wins; non-semver tags (`latest`) ignored.
- In-memory TTL cache: successful checks live 12h, failures 1h (no
  hammering). On-demand from the route; no new background task.
- `GET /api/update` → `{current, latest, update_available}`. Disabled,
  network-failed, or unparseable → `latest: null, update_available:
  null` and 200 — invariant #1, the route never 5xxes for this.
- Setting `update_check` (env `UPDATE_CHECK`, env-first like every
  credential): any of `0/false/no/off` disables the phone-home.
  Registered in SETTING_ENV so /api/connections carries it.
- Internal env `UPDATE_CHECK_URL` overrides the registry endpoint —
  exists so smokes/tests can point at a fixture; undocumented knob.

## Frontend

- `GET /api/update` via a shared React Query key (12h staleTime) used in
  two places:
  - Settings rail foot: plain `v1.10.0` normally; when news, a gold link
    "v1.10.1 available" (to github.com/decidarr/decidarr/releases)
    beside the current version.
  - A small gold dot on the Settings nav item (top bar + bottom nav) so
    an update is noticeable without being nagged. No modals, no toasts.
- Connections section: a "Check for updates" toggle row writing
  `update_check` via the existing admin-gated PUT (env-locked when env
  set).

## Testing

- MockTransport tests for the fetcher (newer / equal / non-semver noise /
  network down); semver compare unit tests; route tests incl. disabled.
- Browser smoke of both states — the fixture URL serves a fake tags list
  so the gold state is honestly reachable in a smoke.
