import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Disc3, History as HistoryIcon, Settings as SettingsIcon, Trophy } from "lucide-react";

import { getPool, getState } from "./api";
import { AdminPinPrompt } from "./components/AdminPin";
import { Console } from "./components/Console";
import { Duel } from "./components/Duel";
import { Header } from "./components/Header";
import { IdentityGate } from "./components/IdentityGate";
import { Onboarding } from "./components/Onboarding";
import { Settings } from "./components/Settings";
import { Stage } from "./components/Stage";
import { Toast } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { TonightCard } from "./components/TonightCard";
import { Board, BoardStrip, History, HistoryRail } from "./components/Views";
import { ReelMark } from "./components/ReelMark";
import { S } from "./strings";
import { useSession } from "./store";
import { useIsDesktop } from "./useIsDesktop";

export type View = "spin" | "history" | "board" | "settings";

const queryClient = new QueryClient();

function AppShell() {
  const { playerId, stream, setPlayer, setStream } = useSession();
  const [view, setView] = useState<View>("spin");
  const [identityOpen, setIdentityOpen] = useState(false);
  const [duelOpen, setDuelOpen] = useState(false);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();

  const stateQuery = useQuery({ queryKey: ["state"], queryFn: getState });
  const poolQuery = useQuery({
    queryKey: ["pool", stream],
    queryFn: () => getPool(stream),
    enabled: !!stateQuery.data,
  });

  // Decided once, the first time /api/state resolves — a fresh install with
  // no players triggers the wizard. Deliberately NOT re-derived from the
  // live player count on every render: step 1 of the wizard adds a player,
  // which must not make the wizard vanish out from under steps 2–4. Refs
  // are safe to mutate during render (unlike state) and don't trigger an
  // extra pass, so this reads cleanly as "decide once, use forever".
  const onboardingDecided = useRef<boolean | null>(null);

  if (stateQuery.isLoading) {
    return <div className="app app--centered">{S.common.loading}</div>;
  }
  if (stateQuery.isError || !stateQuery.data) {
    return <div className="app app--centered">{S.emptyWheel.error}</div>;
  }

  const state = stateQuery.data;
  if (onboardingDecided.current === null) {
    onboardingDecided.current = state.players.length === 0;
  }

  if (onboardingDecided.current && !onboardingSkipped) {
    return (
      <div className="app app--centered">
        <Onboarding onFinish={() => setOnboardingSkipped(true)} />
        <AdminPinPrompt />
      </div>
    );
  }

  if (playerId == null) {
    return (
      <div className="app app--centered">
        <IdentityGate players={state.players} current={playerId} onSelect={setPlayer} />
      </div>
    );
  }

  const player = state.players.find((p) => p.id === playerId) ?? null;
  const pool = poolQuery.data ?? [];
  const seen = state.seen[stream] ?? [];
  const hasActivePool = state.pools[stream] != null;
  const currentPick = state.current_picks[stream];

  return (
    <div className="app">
      {isDesktop ? (
        <TopBar
          player={player}
          stream={stream}
          setStream={setStream}
          view={view}
          setView={setView}
          onOpenIdentity={() => setIdentityOpen(true)}
        />
      ) : (
        <Header
          player={player}
          stream={stream}
          setStream={setStream}
          onOpenIdentity={() => setIdentityOpen(true)}
        />
      )}

      {/* Desktop moves the tonight card into the rail; mobile keeps it
          pinned above the stage. */}
      {!isDesktop && currentPick && (
        <TonightCard key={currentPick.item_key} pick={currentPick} />
      )}

      <main className="app__main">
        {view === "spin" && (isDesktop ? (
          <div className="theater">
            <div className="theater__stage">
              {currentPick && (
                <TonightCard
                  key={currentPick.item_key}
                  pick={currentPick}
                  variant="stage"
                  poolItem={pool.find((i) => i.item_key === currentPick.item_key) ?? null}
                />
              )}
              <Stage
                pool={pool}
                seen={seen}
                poolLoading={poolQuery.isLoading}
                hasActivePool={hasActivePool}
                poolName={state.pools[stream]?.name ?? null}
                pickKey={currentPick?.item_key ?? null}
                onOpenSettings={() => setView("settings")}
                onLaunchDuel={() => setDuelOpen(true)}
              />
            </div>
            <div className="theater__rail">
              <ReelMark variant="outline" size={380} className="theater__watermark" />
              <Console pool={pool} />
              <HistoryRail history={state.history} grudges={state.grudges} />
              <BoardStrip players={state.players} />
            </div>
          </div>
        ) : (
          <>
            <Stage
              pool={pool}
              seen={seen}
              poolLoading={poolQuery.isLoading}
              hasActivePool={hasActivePool}
              poolName={state.pools[stream]?.name ?? null}
              pickKey={currentPick?.item_key ?? null}
              onOpenSettings={() => setView("settings")}
              onLaunchDuel={() => setDuelOpen(true)}
            />
            <Console pool={pool} />
          </>
        ))}
        {view === "history" && <History history={state.history} grudges={state.grudges} />}
        {view === "board" && <Board players={state.players} />}
        {view === "settings" && <Settings />}
      </main>

      {!isDesktop && (
        <nav className="bottom-nav">
          <NavButton active={view === "spin"} label={S.nav.spin} onClick={() => setView("spin")}>
            <Disc3 size={20} aria-hidden="true" />
          </NavButton>
          <NavButton active={view === "history"} label={S.nav.history} onClick={() => setView("history")}>
            <HistoryIcon size={20} aria-hidden="true" />
          </NavButton>
          <NavButton active={view === "board"} label={S.nav.board} onClick={() => setView("board")}>
            <Trophy size={20} aria-hidden="true" />
          </NavButton>
          <NavButton active={view === "settings"} label={S.nav.settings} onClick={() => setView("settings")}>
            <SettingsIcon size={20} aria-hidden="true" />
          </NavButton>
        </nav>
      )}

      {identityOpen && (
        <IdentityGate
          players={state.players}
          current={playerId}
          onSelect={setPlayer}
          onClose={() => setIdentityOpen(false)}
        />
      )}
      {duelOpen && (
        <Duel
          players={state.players}
          pool={pool}
          seen={seen}
          onClose={() => setDuelOpen(false)}
          onDone={() => {
            // duelWin already committed current_picks server-side — close the
            // duel and let TonightCard pick it up, same handoff as PickCard's
            // onCommitted.
            setDuelOpen(false);
            queryClient.invalidateQueries({ queryKey: ["state"] });
          }}
        />
      )}

      <AdminPinPrompt />
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
      {/* Single Toast host at the app root — it must render in every
          AppShell state (loading, error, onboarding, identity gate, main)
          so an enqueued toast (e.g. the SW "new version" prompt) is never
          silently swallowed by an early-return branch. */}
      <Toast />
    </QueryClientProvider>
  );
}

export default App;
