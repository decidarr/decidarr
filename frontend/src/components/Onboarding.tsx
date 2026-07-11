// First-run wizard: shown when no players exist yet. Linear, skippable,
// four steps — but each step's actual UI IS the matching Settings section
// component (Players / Connections / Pools), just walked in order. Skip
// jumps straight to the (empty) wheel; step 4 has no component of its own,
// it just points the player at the Spin tab and closes the wizard.
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { listPlayers } from "../api";
import { S } from "../strings";
import { ConnectionsSection, PlayersSection, PoolsSection, isActive } from "./Settings";

export interface OnboardingProps {
  onFinish: () => void;
}

const STEP_COUNT = S.onboarding.steps.length;

export function Onboarding({ onFinish }: OnboardingProps) {
  const [step, setStep] = useState(0);
  // Shares the ["players"] query cache with <PlayersSection/> below — the
  // moment the player adds someone there, this count updates too, without
  // any prop plumbing between the two.
  const playersQuery = useQuery({ queryKey: ["players"], queryFn: listPlayers });
  const playerCount = (playersQuery.data ?? []).filter(isActive).length;

  const meta = S.onboarding.steps[step];
  const isFirst = step === 0;
  const isLast = step === STEP_COUNT - 1;
  const canAdvance = !isFirst || playerCount > 0;

  return (
    <div className="onboarding">
      <h1 className="onboarding__welcome">{S.onboarding.welcome}</h1>

      <div className="onboarding__progress" role="presentation">
        {S.onboarding.steps.map((s, i) => (
          <span
            key={s.title}
            className={"onboarding__dot" + (i === step ? " onboarding__dot--active" : "")}
          />
        ))}
      </div>

      <h2 className="onboarding__step-title">{meta.title}</h2>
      <p className="onboarding__step-body">{meta.body}</p>

      <div className="onboarding__section">
        {step === 0 && <PlayersSection />}
        {step === 1 && <ConnectionsSection />}
        {step === 2 && <PoolsSection />}
        {step === 3 && <p className="onboarding__spin-prompt">{S.onboarding.spinPrompt}</p>}
      </div>

      <div className="onboarding__nav">
        {!isFirst && (
          <button type="button" className="btn-secondary" onClick={() => setStep((s) => s - 1)}>
            {S.onboarding.back}
          </button>
        )}
        <button type="button" className="btn-link" onClick={onFinish}>
          {S.onboarding.skip}
        </button>
        {isLast ? (
          <button type="button" className="btn-primary" onClick={onFinish}>
            {S.onboarding.finish}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={!canAdvance}
            onClick={() => setStep((s) => s + 1)}
          >
            {S.onboarding.next}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
