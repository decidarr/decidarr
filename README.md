# Decidarr

**The movie-night decision engine for the \*arr stack.**

> Status: early development. The name is claimed, the code is coming. Decidarr is the public evolution of Swamp Roulette, a private two-player movie picker already running happily in production.

You have Radarr, a Plex library, and a watchlist a mile long -- and you still spend twenty minutes arguing about what to watch. Decidarr turns the decision into a game: spin a wheel over a curated pool of films, and if tonight's pick isn't in your library yet, one tap summons it through Overseerr and Radarr, with a live download progress bar until it lands in Plex.

## What makes it different

Existing pickers choose from what your media server already has. Decidarr treats the whole \*arr stack as its backend: it can land on a film you don't own yet and fetch it on the spot.

It also knows that picking a movie with other people is a negotiation:

- **Veto tokens** - one per person per night; a veto re-spins the wheel
- **Duels** - each person spins once, then crown a winner or let fate decide
- **Blind pick** - spin with the title masked; commit before you judge
- **Grudge list** - films vetoed again and again, with the culprits named
- **The scoreboard** - who watched, who requested, who vetoed

## Planned architecture

- Single Docker container: FastAPI + SQLite, mobile-first PWA frontend
- Integrations: Overseerr or Jellyseerr for requests, Radarr for download progress, Plex for playback
- Pluggable film pools: Trakt, mdblist, TMDB and Letterboxd lists
- Configurable players, two or more

## Status

Decidarr is not yet ready to install. Star or watch the repo to follow along.

## License

GPL-3.0
