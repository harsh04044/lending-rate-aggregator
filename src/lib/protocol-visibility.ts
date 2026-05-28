import { Protocol } from "@/app/types/main";

// Render-layer hide list. The data layer still fetches and processes these
// protocols; this just keeps them out of pickers, lists, and selectable UI
// surfaces. Remove from this set to re-enable a protocol.
export const HIDDEN_PROTOCOLS: ReadonlySet<Protocol> = new Set([
  Protocol.Drift,
]);

export function isProtocolVisible(p: Protocol): boolean {
  return !HIDDEN_PROTOCOLS.has(p);
}
