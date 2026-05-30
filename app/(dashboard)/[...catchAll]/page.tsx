import { notFound } from "next/navigation";

// Catches any URL not matched by a specific route in the dashboard group
// and routes it through the group's not-found.tsx so the 404 renders
// inside the sidebar shell. More specific routes still take precedence.
export default function CatchAllNotFound() {
  notFound();
}
