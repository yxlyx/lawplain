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
  /** Shared Ask history rail state so its toggle can live in the app header. */
  askSidebarOpen: boolean;
  setAskSidebarOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  askSidebarAvailable: boolean;
  setAskSidebarAvailable: (available: boolean) => void;
  askSidebarUnread: boolean;
  setAskSidebarUnread: (unread: boolean) => void;
}

const ChromeContext = createContext<ChromeState>({
  searchActive: false,
  setSearchActive: () => {},
  hideFooter: false,
  setHideFooter: () => {},
  askSidebarOpen: false,
  setAskSidebarOpen: () => {},
  askSidebarAvailable: false,
  setAskSidebarAvailable: () => {},
  askSidebarUnread: false,
  setAskSidebarUnread: () => {},
});

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [searchActive, setSearchActive] = useState(false);
  const [hideFooter, setHideFooter] = useState(false);
  const [askSidebarOpen, setAskSidebarOpen] = useState(false);
  const [askSidebarAvailable, setAskSidebarAvailable] = useState(false);
  const [askSidebarUnread, setAskSidebarUnread] = useState(false);
  const value = useMemo(
    () => ({
      searchActive,
      setSearchActive,
      hideFooter,
      setHideFooter,
      askSidebarOpen,
      setAskSidebarOpen,
      askSidebarAvailable,
      setAskSidebarAvailable,
      askSidebarUnread,
      setAskSidebarUnread,
    }),
    [
      searchActive,
      hideFooter,
      askSidebarOpen,
      askSidebarAvailable,
      askSidebarUnread,
    ],
  );
  return (
    <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>
  );
}

export function useChrome(): ChromeState {
  return useContext(ChromeContext);
}
