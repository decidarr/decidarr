import { useState } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Disc3, History, Settings as SettingsIcon, Trophy } from "lucide-react";

import { getPool, getState } from "./api";
import { FiltersSheet } from "./components/FiltersSheet";
import { Header } from "./components/Header";
import { IdentityGate } from "./components/IdentityGate";
import { Stage } from "./components/Stage";
import { Toast } from "./components/Toast";
import { TonightCard } from "./components/TonightCard";
import { activeFilterCount } from "./logic";
import { S } from "./strings";
import { useSession } from "./store";

type View = "spin" | "history" | "board" | "settings";

const queryClient = new QueryClient();

function AppShell() {
  const { playerId, stream, filters, setPlayer, setStream } = useSession();
  const [view, setView] = useState<View>("spin");
  const [identityOpen, setIdentityOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const stateQuery = useQuery({ queryKey: ["state"], queryFn: getState });
  const poolQuery = useQuery({
    queryKey: ["pool", stream],
    queryFn: () => getPool(stream),
    enabled: !!stateQuery.data,
  });

  if (stateQuery.isLoading) {
    return <div className="app app--centered">{S.common.loading}</div>;
  }
  if (stateQuery.isError || !stateQuery.data) {
    return <div className="app app--centered">{S.emptyWheel.error}</div>;
  }

  const state = stateQuery.data;

  // No players configured yet — the real Onboarding flow is Task 22; until
  // it lands, the identity gate's empty state keeps the app usable instead
  // of hard-locking on a blank screen.
  if (state.players.length === 0 || playerId == null) {
    return (
      <div className="app app--centered">
        <IdentityGate players={state.players} current={playerId} onSelect={setPlayer} />
      </div>
    );
  }

  const player = state.players.find((p) => p.id === playerId) ?? null;
  const pool = poolQuery.data ?? [];
  const seen = state.seen[stream] ?? [];
  const filterCount = activeFilterCount(filters);
  const hasActivePool = state.pools[stream] != null;
  const currentPick = state.current_picks[stream];

  return (
    <div className="app">
      <Header
        player={player}
        stream={stream}
        setStream={setStream}
        filterCount={filterCount}
        onOpenIdentity={() => setIdentityOpen(true)}
        onOpenFilters={() => setFiltersOpen(true)}
      />

      {currentPick && <TonightCard key={currentPick.item_key} pick={currentPick} />}

      <main className="app__main">
        {view === "spin" && (
          <Stage
            pool={pool}
            seen={seen}
            poolLoading={poolQuery.isLoading}
            hasActivePool={hasActivePool}
            onOpenSettings={() => setView("settings")}
          />
        )}
        {view === "history" && (
          <PlaceholderPanel title={S.history.title} body={S.history.empty} />
        )}
        {view === "board" && (
          <PlaceholderPanel title={S.board.title} body={S.board.loading} />
        )}
        {view === "settings" && (
          <PlaceholderPanel title={S.settings.title} body={S.settings.pinRequired} />
        )}
      </main>

      <nav className="bottom-nav">
        <NavButton active={view === "spin"} label={S.nav.spin} onClick={() => setView("spin")}>
          <Disc3 size={20} aria-hidden="true" />
        </NavButton>
        <NavButton active={view === "history"} label={S.nav.history} onClick={() => setView("history")}>
          <History size={20} aria-hidden="true" />
        </NavButton>
        <NavButton active={view === "board"} label={S.nav.board} onClick={() => setView("board")}>
          <Trophy size={20} aria-hidden="true" />
        </NavButton>
        <NavButton active={view === "settings"} label={S.nav.settings} onClick={() => setView("settings")}>
          <SettingsIcon size={20} aria-hidden="true" />
        </NavButton>
      </nav>

      {identityOpen && (
        <IdentityGate
          players={state.players}
          current={playerId}
          onSelect={setPlayer}
          onClose={() => setIdentityOpen(false)}
        />
      )}
      {filtersOpen && (
        <FiltersSheet stream={stream} pool={pool} onClose={() => setFiltersOpen(false)} />
      )}

      <Toast />
    </div>
  );
}

function NavButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={"bottom-nav__item" + (active ? " bottom-nav__item--active" : "")}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function PlaceholderPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="placeholder-panel">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}

export default App;
