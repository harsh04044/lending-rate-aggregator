"use client";

/* ═══════════════════════════════════════════════════════════════════════════════
   Token & Protocol SVG Icons
   Simplified but distinctive brand-representative icons
   ═══════════════════════════════════════════════════════════════════════════════ */

interface IconProps {
  size?: number;
  className?: string;
}

// ─── Token Icons ────────────────────────────────────────────────────────────

export function SolanaIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
    >
      <defs>
        <linearGradient id="sol-grad" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="16" fill="#1a0a2e" />
      <path d="M9 20.5h11.5l2.5-2.5H11.5L9 20.5z" fill="url(#sol-grad)" />
      <path d="M9 11.5L11.5 14H23l-2.5-2.5H9z" fill="url(#sol-grad)" />
      <path d="M9 16l2.5 2.5H23L20.5 16H9z" fill="url(#sol-grad)" />
    </svg>
  );
}

export function StSOLIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
    >
      <rect width="32" height="32" rx="16" fill="#0a2018" />
      <path d="M9 20.5h11.5l2.5-2.5H11.5L9 20.5z" fill="#00D18C" />
      <path d="M9 11.5L11.5 14H23l-2.5-2.5H9z" fill="#00D18C" />
      <path d="M9 16l2.5 2.5H23L20.5 16H9z" fill="#00D18C" />
      <circle
        cx="24"
        cy="8"
        r="4"
        fill="#0a2018"
        stroke="#00D18C"
        strokeWidth="1.5"
      />
      <text
        x="24"
        y="10"
        textAnchor="middle"
        fill="#00D18C"
        fontSize="5"
        fontWeight="bold"
      >
        S
      </text>
    </svg>
  );
}

export function USDCIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
    >
      <rect width="32" height="32" rx="16" fill="#0a1a2e" />
      <circle
        cx="16"
        cy="16"
        r="11"
        stroke="#2775CA"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M16 8v2M16 22v2"
        stroke="#2775CA"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M13.5 13c0-1.1.9-2 2.5-2s2.5.9 2.5 2-.9 1.5-2.5 2-2.5 1-2.5 2 .9 2 2.5 2 2.5-.9 2.5-2"
        stroke="#2775CA"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function JupiterIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
    >
      <rect width="32" height="32" rx="16" fill="#0a1e22" />
      <circle
        cx="16"
        cy="16"
        r="8"
        stroke="#1FC7D4"
        strokeWidth="1.5"
        fill="none"
      />
      <ellipse
        cx="16"
        cy="16"
        rx="12"
        ry="4"
        stroke="#1FC7D4"
        strokeWidth="1"
        fill="none"
        opacity="0.5"
      />
      <circle cx="16" cy="16" r="3" fill="#1FC7D4" opacity="0.6" />
    </svg>
  );
}

export function BonkIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
    >
      <rect width="32" height="32" rx="16" fill="#1e1408" />
      <circle
        cx="16"
        cy="16"
        r="9"
        stroke="#F7931A"
        strokeWidth="1.5"
        fill="none"
      />
      <text
        x="16"
        y="20"
        textAnchor="middle"
        fill="#F7931A"
        fontSize="11"
        fontWeight="bold"
        fontFamily="monospace"
      >
        B
      </text>
    </svg>
  );
}

export function JitoSOLIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
    >
      <rect width="32" height="32" rx="16" fill="#120a22" />
      <defs>
        <linearGradient id="jito-grad" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path d="M9 20.5h11.5l2.5-2.5H11.5L9 20.5z" fill="url(#jito-grad)" />
      <path d="M9 11.5L11.5 14H23l-2.5-2.5H9z" fill="url(#jito-grad)" />
      <path d="M9 16l2.5 2.5H23L20.5 16H9z" fill="url(#jito-grad)" />
    </svg>
  );
}

export function MSolIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
    >
      <rect width="32" height="32" rx="16" fill="#0a1520" />
      <path
        d="M10 21l3-10 3 6 3-6 3 10"
        stroke="#5BC5A7"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// ─── Icon Resolver ──────────────────────────────────────────────────────────

const TOKEN_ICONS: Record<string, React.ComponentType<IconProps>> = {
  SOL: SolanaIcon,
  stSOL: StSOLIcon,
  USDC: USDCIcon,
  JUP: JupiterIcon,
  BONK: BonkIcon,
  JitoSOL: JitoSOLIcon,
  mSOL: MSolIcon,
};

// Brand logos shipped under public/. Keys are normalized (lowercased) so
// "Save", "save", "JupLend", "Juplend", etc. all resolve to the right asset.
const PROTOCOL_LOGOS: Record<string, string> = {
  kamino: "/kamino.svg",
  drift: "/drift.svg",
  juplend: "/juplend.webp",
  save: "/save.svg",
};

export function TokenIcon({
  symbol,
  logoUrl,
  size = 20,
  className,
}: {
  symbol: string;
  logoUrl?: string;
  size?: number;
  className?: string;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={symbol}
        width={size}
        height={size}
        className={`object-cover rounded-full bg-[rgba(255,255,255,0.04)] ${className ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const Icon = TOKEN_ICONS[symbol];
  if (Icon) return <Icon size={size} className={className} />;
  // Fallback
  return (
    <div
      className="rounded-full flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <span style={{ fontSize: size * 0.4, color: "#8A9DB5", fontWeight: 700 }}>
        {symbol[0]}
      </span>
    </div>
  );
}

// Two overlapping token logos — used for vault / lending-pair representations.
export function TokenPairIcon({
  collateralSymbol,
  debtSymbol,
  collateralLogoUrl,
  debtLogoUrl,
  size = 24,
  className,
}: {
  collateralSymbol: string;
  debtSymbol: string;
  collateralLogoUrl?: string;
  debtLogoUrl?: string;
  size?: number;
  className?: string;
}) {
  // Each circle is `size`; the second is shifted right by ~55% of size so they
  // visibly intertwine. Total width is size + overlap.
  const overlap = Math.round(size * 0.55);
  const totalWidth = size + overlap;
  return (
    <div
      className={`relative shrink-0 ${className ?? ""}`}
      style={{ width: totalWidth, height: size }}
    >
      <div
        className="absolute top-0 left-0 rounded-full ring-1 ring-[rgba(0,0,0,0.5)]"
        style={{ width: size, height: size }}
      >
        <TokenIcon
          symbol={collateralSymbol}
          logoUrl={collateralLogoUrl}
          size={size}
        />
      </div>
      <div
        className="absolute top-0 rounded-full ring-1 ring-[rgba(0,0,0,0.5)]"
        style={{ left: overlap, width: size, height: size }}
      >
        <TokenIcon symbol={debtSymbol} logoUrl={debtLogoUrl} size={size} />
      </div>
    </div>
  );
}

export function ProtocolIcon({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const src = PROTOCOL_LOGOS[name.toLowerCase()];
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={src === "kamino" || src === "drift" ? size + 30 : size}
        height={src === "kamino" || src === "drift" ? size + 30 : size}
        className={`object-cover rounded-full ${className ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`rounded-md flex items-center justify-center ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <span style={{ fontSize: size * 0.4, color: "#8A9DB5", fontWeight: 700 }}>
        {name[0]}
      </span>
    </div>
  );
}
