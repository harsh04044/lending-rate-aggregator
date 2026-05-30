"use client";

import { SidebarShell } from "@/src/components/sidebar-shell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SidebarShell>{children}</SidebarShell>;
}
