"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

interface ChromeState {
  /** True while a search is active — drives the header→sidebar morph. */
  searchActive: boolean;
  setSearchActive: (active: boolean) => void;
  /** True while an Ask conversation is active — hides the global footer. */
  hideFooter: boolean;
  setHideFooter: (hide: boolean) => void;
}

const ChromeContext = createContext<ChromeState>({
  searchActive: false,
  setSearchActive: () => {},
  hideFooter: false,
  setHideFooter: () => {},
});

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [searchActive, setSearchActive] = useState(false);
  const [hideFooter, setHideFooter] = useState(false);
  const value = useMemo(
    () => ({ searchActive, setSearchActive, hideFooter, setHideFooter }),
    [searchActive, hideFooter],
  );
  return (
    <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>
  );
}

export function useChrome(): ChromeState {
  return useContext(ChromeContext);
}
