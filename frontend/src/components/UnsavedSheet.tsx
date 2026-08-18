// The unsaved-changes prompt (v1.12). Renders only while a navigation is
// parked in the guard awaiting a decision; Save/Discard proceed, Keep
// editing (or clicking away) stays.
import { useUnsaved } from "../unsaved";
import { S } from "../strings";

export function UnsavedSheet() {
  const pendingNav = useUnsaved((s) => s.pendingNav);
  const { resolveStay, resolveDiscard, resolveSave } = useUnsaved.getState();

  if (!pendingNav) return null;

  return (
    <div
      className="sheet-overlay sheet-overlay--confirm"
      role="presentation"
      onClick={resolveStay}
    >
      <div
        className="sheet confirm-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-label={S.settings.unsaved.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sheet__title">{S.settings.unsaved.title}</h2>
        <p className="confirm-sheet__body">{S.settings.unsaved.body}</p>
        <div className="confirm-sheet__actions">
          <button type="button" className="btn-primary" onClick={() => resolveSave()}>
            {S.settings.unsaved.save}
          </button>
          <button type="button" className="btn-secondary" onClick={resolveDiscard}>
            {S.settings.unsaved.discard}
          </button>
          <button type="button" className="btn-link" onClick={resolveStay}>
            {S.settings.unsaved.stay}
          </button>
        </div>
      </div>
    </div>
  );
}
