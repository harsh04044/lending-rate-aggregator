import Link from "next/link";
import { Compass, ArrowRight } from "lucide-react";

export const metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="relative z-10 flex items-center justify-center py-24 px-6">
      <div className="max-w-md w-full flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6 bg-accent/8 border border-accent/20">
          <Compass size={28} strokeWidth={1.8} className="text-accent" />
        </div>

        <span className="font-(family-name:--font-ibm-plex-mono) text-[12px] font-bold tracking-[0.28em] uppercase text-text-muted mb-2">
          Error 404
        </span>

        <h1 className="font-(family-name:--font-ibm-plex-mono) font-extrabold text-[64px] leading-none tracking-[-0.045em] text-text-bright mb-4">
          404
        </h1>

        <h2 className="font-(family-name:--font-dm-sans) text-[20px] font-bold text-text-base mb-2">
          We can&apos;t find that page
        </h2>

        <p className="font-(family-name:--font-dm-sans) text-[13.5px] font-semibold text-text-muted mb-8">
          The page or protocol you&apos;re looking for doesn&apos;t exist, may
          have moved, or never existed in the first place. Head back to the
          dashboard to keep going.
        </p>

        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-md no-underline cursor-pointer bg-[linear-gradient(135deg,#1DB67D_0%,#27C98C_100%)] text-surface-2 border border-accent/30 hover:shadow-[0_6px_16px_rgba(29,182,125,0.20)] transition-all"
        >
          <span className="font-(family-name:--font-dm-sans) text-[14px] font-bold">
            Back to Dashboard
          </span>
          <ArrowRight size={15} strokeWidth={2.4} />
        </Link>
      </div>
    </div>
  );
}
