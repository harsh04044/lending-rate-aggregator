"use client";

import { useEffect, useRef } from "react";

export function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T | null>(null);
  const cbRef = useRef(onOutside);
  useEffect(() => {
    cbRef.current = onOutside;
  }, [onOutside]);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        cbRef.current();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return ref;
}
