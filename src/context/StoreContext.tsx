import { createContext, useContext, type ReactNode } from "react";
import type PocketBase from "pocketbase";
import { useAppStore, type AppStore } from "../store/useAppStore";

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ pb, children }: { pb: PocketBase; children: ReactNode }) {
  const store = useAppStore(pb);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): AppStore {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

export function useOptionalStore(): AppStore | null {
  return useContext(StoreContext);
}
