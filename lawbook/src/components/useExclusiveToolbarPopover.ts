"use client";

import { useCallback, useEffect, useId, useRef } from "react";

const EXCLUSIVE_TOOLBAR_POPOVER_EVENT = "lawbook:exclusive-toolbar-popover";

type ExclusiveToolbarPopoverEvent = CustomEvent<{ id: string }>;

export function useExclusiveToolbarPopover(onClose: () => void) {
  const id = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    function handleExclusiveOpen(event: Event) {
      const detail = (event as ExclusiveToolbarPopoverEvent).detail;

      if (!detail || detail.id === id) return;

      onCloseRef.current();
    }

    window.addEventListener(
      EXCLUSIVE_TOOLBAR_POPOVER_EVENT,
      handleExclusiveOpen,
    );

    return () => {
      window.removeEventListener(
        EXCLUSIVE_TOOLBAR_POPOVER_EVENT,
        handleExclusiveOpen,
      );
    };
  }, [id]);

  return useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(EXCLUSIVE_TOOLBAR_POPOVER_EVENT, {
        detail: { id },
      }),
    );
  }, [id]);
}
