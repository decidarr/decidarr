// Every scrap of player-facing copy lives here — nowhere else. Components
// pull strings from `S`; personality lives in this file, not in JSX.

export const S = {
  app: {
    name: "Decidarr",
    tagline: "The watch-night decision engine.",
  },

  streams: {
    movie: "Movies",
    tv: "TV",
    groupLabel: "Stream",
  },

  // --- announced the instant a spin starts (theater vs. assistive tech) --
  spinResult: (title: string) => `Landed on ${title}.`,

  // --- app shell / nav -----------------------------------------------
  nav: {
    spin: "Spin",
    history: "History",
    board: "Board",
    settings: "Settings",
  },

  // --- identity gate ---------------------------------------------------
  identity: {
    title: "Who's spinning?",
    empty: "No players yet. Ask an admin to add one in Settings.",
    change: "Switch player",
  },

  // --- header / filters sheet ------------------------------------------
  filters: {
    title: "Filters",
    button: (n: number) => (n > 0 ? `Filters · ${n}` : "Filters"),
    runtime: "Runtime",
    runtimeMinLabel: "Minimum runtime",
    runtimeMaxLabel: "Maximum runtime",
    presets: {
      schoolNight: "School Night",
      committed: "Committed",
    },
    genres: "Genres",
    decade: "Decade",
    anyDecade: "Any decade",
    includeSeen: "Include already seen",
    blindMode: "Blind mode",
    reset: "Reset",
    done: "Done",
  },

  // --- spin stage --------------------------------------------------------
  spin: {
    button: "Spin",
    spinning: "Spinning…",
    again: "Spin again",
    duel: "Duel",
  },

  // --- empty / unconfigured states --------------------------------------
  emptyWheel: {
    title: "Empty wheel",
    noPool: "No active pool for this stream yet. Point an admin at Settings.",
    poolEmpty:
      "The pool's empty. Every pick's been watched, vetoed into oblivion, or nobody's loaded one.",
    allSeen:
      "You've burned through the whole pool. Flip on \"include seen\" or feed it something new.",
    loading: "Shuffling the deck…",
    error: "Couldn't reach the pool. Check the connection and try again.",
    fixes: {
      resetFilters: "Reset filters",
      includeSeen: "Include seen",
      openSettings: "Open Settings",
    },
  },

  // --- veto sass ----------------------------------------------------------
  veto: {
    button: "Veto",
    confirmTitle: "Veto this pick?",
    undoPrompt: "Vetoed. Undo?",
    outOfTokens: "You're out of vetoes for tonight. Live with it.",
    used: (remaining: number) =>
      remaining > 0
        ? `Vetoed. ${remaining} left before you're stuck with whatever comes up.`
        : "Vetoed. That was your last one — no take-backs now.",
    grudgeNoted: "Noted. Forever. The grudge list remembers everything.",
    sass: [
      "Bold move, rejecting the wheel's judgment.",
      "The wheel will remember this.",
      "One veto closer to running out of options.",
      "A veto a day keeps consensus away.",
    ],
  },

  // --- summon / download progress -----------------------------------------
  progress: {
    unconfigured: "Not hooked up — check Settings to wire up the downloader.",
    unknown: "Can't tell what's happening in there.",
    searching: "Hunting for a source…",
    queued: "Queued up, waiting its turn.",
    downloading: "On its way in.",
    importing: "Almost there — tidying up the file.",
    done: "Landed. Go press play.",
    landed: (ready: number, total: number) => `${ready} of ${total} landed`,
    stillHunting:
      "This one's dragging its feet. Might be worth a manual look in Seerr.",
    seerrLink: "Open in Seerr",
    checkBackLater: "Download's still going — check back later.",
    stuck: [
      "This one's dragging its feet. Might be worth a look in Radarr/Sonarr.",
      "Still searching after all this time — the indexers may be having a bad night.",
      "No movement in a while. It's not stuck, it's just... thinking. Probably.",
    ],
  },

  // --- availability chip ---------------------------------------------
  availability: {
    available: "In your library",
    probably: "Probably in your library",
  },

  // --- summon actions -------------------------------------------------
  watch: {
    summon: "Watch Now",
    letsWatch: "Let's Watch",
    summonAction: "Summon",
    requesting: "Summoning…",
    requested: "Requested. It'll show up when it's ready.",
    pendingConflictTitle: "Replace tonight's pick?",
    pendingConflict:
      "There's already a pick tonight for this stream. Replace it?",
    replace: "Replace pick",
    markWatched: "Mark Watched",
    watchedConfirm: "Logged. Enjoy.",
    seenIt: "Seen it",
    seenItRespin: "Already seen it. Respinning.",
    configureHint: "Connect Overseerr/Jellyseerr in Settings to summon this one.",
    manualHint: "Couldn't match this one automatically — grab it manually.",
    clearPick: "Clear pick",
    clearPickConfirm: "Clear tonight's pick? It goes back in the pool.",
  },

  // --- tonight's pick ---------------------------------------------------
  tonight: {
    title: "Tonight",
  },

  // --- duel -----------------------------------------------------------
  duel: {
    title: "Duel",
    start: "Start a Duel",
    spinning: "Fate is deciding…",
    seenItRespin: "Already seen it — respinning that side.",
    crownWinner: "has the crown tonight.",
    proceedToSummon: "Summon the winner",
  },

  // --- flavor titles (scoreboard) --------------------------------------
  flavorTitles: {
    mostVetoed: "Most Vetoed",
    duelChampion: "Duel Champion",
    theSummoner: "The Summoner",
  },

  // --- history / grudge list --------------------------------------------
  history: {
    title: "History",
    empty: "Nothing logged yet. The night is young.",
    grudgesTitle: "Grudge List",
    grudgesEmpty: "No repeat offenders yet.",
  },

  board: {
    title: "Board",
    seenTotal: "Total watched",
    loading: "Tallying the scores…",
  },

  // --- onboarding --------------------------------------------------------
  onboarding: {
    welcome: "Welcome to Decidarr",
    steps: [
      {
        title: "Add your players",
        body: "Everyone who'll be spinning the wheel gets a name and (optionally) an emoji.",
      },
      {
        title: "Connect your services",
        body: "Point Decidarr at Overseerr or Jellyseerr, plus Radarr/Sonarr for download progress. Plex or Jellyfin is optional but makes availability checks instant.",
      },
      {
        title: "Load a pool",
        body: "Pull from TMDB or Trakt, or import your own curated list. One pool per stream — movies and TV never mix.",
      },
      {
        title: "Spin",
        body: "Pick a stream, spin the wheel, and let the night decide.",
      },
    ],
    finish: "Let's go",
    skip: "Skip setup",
  },

  // --- settings / admin ----------------------------------------------
  settings: {
    title: "Settings",
    pinRequired: "Enter the admin PIN to make changes.",
    pinIncorrect: "Wrong PIN.",
    envLocked: "Set via environment variable — read-only here.",
    connectionTest: {
      testing: "Testing…",
      ok: "Connected.",
      fail: "Couldn't connect.",
    },
    resetSeenConfirm:
      "Clear the seen list? Everything goes back into the pool.",
  },

  // --- attribution ---------------------------------------------------
  attribution: {
    tmdb: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    trakt: "Pool data powered by Trakt.",
  },

  // --- generic --------------------------------------------------------
  common: {
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
    retry: "Try again",
    loading: "Loading…",
    save: "Save",
    undo: "Undo",
    writeFailed: "Couldn't save that. Try again.",
  },
} as const;
