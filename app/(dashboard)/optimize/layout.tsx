import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Optimize",
};

export default function OptimizeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
