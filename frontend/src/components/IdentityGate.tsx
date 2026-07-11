// "Who's spinning?" — player-chip grid. Rendered full-screen when nobody has
// claimed an identity yet (App.tsx, playerId === null), or as a closable
// sheet from the Header's identity chip to switch players mid-session.
import type { Player } from "../types";
import { S } from "../strings";

interface IdentityGateProps {
  players: Player[];
  current: number | null;
  onSelect: (id: number) => void;
  /** Present when opened as a sheet (Header identity chip); absent for the
   * full-screen gate shown before any player is picked. */
  onClose?: () => void;
}

export function IdentityGate({ players, current, onSelect, onClose }: IdentityGateProps) {
  const body = (
    <div className="identity-gate__body">
      <h1 className="identity-gate__title">{S.identity.title}</h1>
      {players.length === 0 ? (
        <p className="identity-gate__empty">{S.identity.empty}</p>
      ) : (
        <div className="identity-gate__grid">
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              className={
                "identity-chip" + (p.id === current ? " identity-chip--active" : "")
              }
              onClick={() => {
                onSelect(p.id);
                onClose?.();
              }}
            >
              {p.emoji && <span className="identity-chip__emoji">{p.emoji}</span>}
              <span className="identity-chip__name">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (!onClose) {
    return (
      <div className="identity-gate identity-gate--full">
        {body}
      </div>
    );
  }

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="sheet identity-gate identity-gate--sheet"
        role="dialog"
        aria-modal="true"
        aria-label={S.identity.title}
        onClick={(e) => e.stopPropagation()}
      >
        {body}
        <button type="button" className="sheet__close" onClick={onClose}>
          {S.common.close}
        </button>
      </div>
    </div>
  );
}
