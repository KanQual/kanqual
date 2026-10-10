import { lazy, type ComponentType } from "react";

/** Share one module request between navigation intent and the eventual render. */
export function preloadableLazy<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) {
  let pending: Promise<{ default: T }> | undefined;
  const load = () => {
    if (!pending) pending = loader().catch(error => { pending = undefined; throw error; });
    return pending;
  };
  return Object.assign(lazy(load), {
    // Preloading is best-effort; a failed hover request must not poison navigation.
    preload: () => { void load().catch(() => {}); },
  });
}
