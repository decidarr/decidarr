import { useEffect, useState } from "react";

const QUERY = "(min-width: 960px)";

/** True at the Two-Pane Theater breakpoint. Listener-driven so a resize (or
 * a rotated tablet) re-renders into the other layout; guarded for
 * environments without matchMedia so tests and SSR never throw. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => typeof window !== "undefined" && !!window.matchMedia
      && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    // Re-sync on mount: the query may have changed between the initial
    // state and this effect (hydration, fast resize).
    setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
