import { useState } from "react";
import { ProtocolDetail } from "../page";
import { motion } from "framer-motion";
import { Clock } from "lucide-react";
import { Title4 } from "@/src/components/ui/title-4";
import { C } from "@/src/lib/theme";

type HistoryAction = "SUPPLY" | "BORROW" | "REPAY" | "WITHDRAW" | "REFINANCE";

export interface HistoryEntry {
  date: string;
  action: HistoryAction;
  amount: string;
  symbol: string;
  valueUsd: string;
  txHash: string;
}

const ACTION_STYLES: Record<
  HistoryAction,
  { color: string; bg: string; border: string }
> = {
  SUPPLY: { color: C.accent, bg: C.accentTint, border: C.accentBord },
  BORROW: {
    color: C.red,
    bg: "rgba(229,83,75,0.08)",
    border: "rgba(229,83,75,0.22)",
  },
  REPAY: {
    color: C.cyan,
    bg: "rgba(58,175,207,0.06)",
    border: "rgba(58,175,207,0.18)",
  },
  WITHDRAW: {
    color: C.yellow,
    bg: "rgba(229,169,62,0.08)",
    border: "rgba(229,169,62,0.22)",
  },
  REFINANCE: {
    color: "#A78BFA",
    bg: "rgba(167,139,250,0.08)",
    border: "rgba(167,139,250,0.22)",
  },
};

function ActionBadge({ action }: { action: HistoryAction }) {
  const s = ACTION_STYLES[action];
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-sm text-[12px] font-semibold tracking-[0.08em] uppercase"
      style={{
        color: s.color,
        background: s.bg,
      }}
    >
      {action}
    </span>
  );
}

function shortenHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return hash.slice(0, 5) + "..." + hash.slice(-4);
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      whileHover={{ y: -0.5 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      <div
        className="grid items-center px-5 py-4 cursor-default"
        style={{
          gridTemplateColumns: "130px 110px 1fr 130px",
          background: hovered ? C.white04 : "transparent",
          borderBottom: `1px solid ${C.border}`,
          transition: "background 150ms ease",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Date */}
        <span className="text-[13.5px] font-(family-name:--font-ibm-plex-mono) font-bold text-text-dim">
          {entry.date}
        </span>

        {/* Action */}
        <div>
          <ActionBadge action={entry.action} />
        </div>

        {/* Detail */}
        {/* TODO INTEGRATION: render USD value next to the amount once the
        history endpoint returns a per-token priceUsd / amountUsd snapshot. */}
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-(family-name:--font-ibm-plex-mono) font-bold text-text-base">
            {entry.amount} {entry.symbol}
          </span>
        </div>

        {/* TX Hash */}
        <a
          href={`https://solscan.io/tx/${entry.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-right text-[13.5px] font-bold font-(family-name:--font-ibm-plex-mono) cursor-pointer"
          style={{
            color: hovered ? C.textSec : C.textMuted,
            textDecoration: hovered ? "underline" : "none",
            textUnderlineOffset: 3,
            transition: "color 150ms ease",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {shortenHash(entry.txHash)}
        </a>
      </div>
    </motion.div>
  );
}

function HistoryTable({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border overflow-hidden bg-white/2 border-border-base">
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: C.white08 }}
          >
            <Clock size={18} strokeWidth={1.6} className="text-text-muted" />
          </div>
          <span className="text-[14px] font-bold text-text-dim">
            No activity yet
          </span>
          <span className="text-[12px] font-semibold text-text-muted">
            Your protocol transactions will appear here.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden bg-white/2 border-border-base">
      {/* Column headers */}
      <div
        className="grid px-5 py-3"
        style={{
          gridTemplateColumns: "130px 110px 1fr 130px",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        {["Date", "Action", "Detail", "TX Hash"].map((h) => (
          <Title4 key={h} text={h} />
        ))}
      </div>

      {/* Rows */}
      {entries.map((entry, i) => (
        <HistoryRow key={`${entry.txHash}-${i}`} entry={entry} />
      ))}
    </div>
  );
}

export function HistoryTab({ protocol }: { protocol: ProtocolDetail }) {
  return <HistoryTable entries={protocol.history} />;
}
