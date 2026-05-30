import type { Metadata } from "next";

const SLUG_TO_NAME: Record<string, string> = {
  kamino: "Kamino",
  drift: "Drift",
  save: "Save",
  juplend: "Juplend",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const name = SLUG_TO_NAME[slug] ?? "Protocol";
  return { title: name };
}

export default function ProtocolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
