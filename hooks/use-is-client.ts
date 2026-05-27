"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Returns `false` during SSR and the initial hydration pass, then
 * `true` once we're on the client. The canonical React-19-safe
 * replacement for the `const [mounted, setMounted] = useState(false);
 * useEffect(() => setMounted(true), [])` pattern, which the
 * `react-hooks/set-state-in-effect` rule (correctly) flags.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
