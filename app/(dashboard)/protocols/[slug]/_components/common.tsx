import { Title4 } from "@/src/components/ui/title-4";
import { C } from "@/src/lib/theme";
import { TokenIcon } from "@/src/components/icons/token-icons";

export function AssetSelectorButton({
  symbol,
  meta,
  active,
  onClick,
}: {
  symbol: string;
  meta: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2.5 rounded-md cursor-pointer transition-colors"
      style={{ background: active ? C.active : "transparent" }}
    >
      <TokenIcon symbol={symbol} size={20} />
      <span
        className="font-(family-name:--font-dm-sans) text-[14px] font-bold"
        style={{ color: active ? C.text : C.textSec }}
      >
        {symbol}
      </span>
      <span className="font-(family-name:--font-ibm-plex-mono) text-[11px] font-semibold text-text-muted">
        {meta}
      </span>
    </button>
  );
}

export function AmountInput({
  value,
  onChange,
  max,
  approxUsd,
  onMax,
  inputRef,
  autoFocus,
  placeholder = "0.00",
}: {
  value: string;
  onChange: (raw: string) => void;
  max?: number;
  approxUsd?: string;
  onMax: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-3.5 mb-4">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          if (max !== undefined) {
            const v = parseFloat(raw) || 0;
            onChange(v > max ? String(max) : raw);
          } else {
            onChange(raw);
          }
        }}
        className="flex-1 bg-transparent font-(family-name:--font-ibm-plex-mono) text-[18px] font-medium outline-none placeholder:opacity-30 text-text-base"
      />
      <div className="flex items-center gap-3">
        {approxUsd !== undefined && (
          <span className="text-[12px] font-semibold font-(family-name:--font-ibm-plex-mono) text-text-muted">
            ≈ {approxUsd}
          </span>
        )}
        <button
          type="button"
          onClick={onMax}
          className="p-2 cursor-pointer bg-surface-2 rounded-sm font-(family-name:--font-dm-sans) text-[14px] font-bold shrink-0 text-text-muted"
        >
          MAX
        </button>
      </div>
    </div>
  );
}

export function PremiumSlider({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const markers = [0, 25, 50, 75, 100];

  return (
    <div>
      <div className="relative px-0.5">
        <div className="relative h-2.5 rounded-full overflow-hidden bg-border-base">
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${pct}%`,
              background: C.accent,
              transition: "width 60ms ease",
            }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={max}
          step={max > 1000 ? 10 : max > 100 ? 1 : 0.1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          style={{ height: 36, marginTop: -14 }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4.5 h-4.5 rounded-full border-3 border-border-base pointer-events-none"
          style={{
            left: `calc(${pct}% - 9px)`,
            background: C.card,
            transition: "left 60ms ease",
          }}
        />
      </div>
      <div className="flex items-center justify-between mt-2 px-0.5">
        {markers.map((m) => (
          <button
            key={m}
            type="button"
            className="text-[14px] font-bold cursor-pointer"
            style={{
              color: Math.round(pct) >= m ? C.accent : C.textMuted,
              transition: "color 150ms ease",
            }}
            onClick={() => onChange((max * m) / 100)}
          >
            {m}%
          </button>
        ))}
      </div>
    </div>
  );
}

export function CompactMetricCard({
  icon: Icon,
  label,
  value,
  sub,
  valueColor,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
}) {
  return (
    <div className="flex-1 rounded-lg border px-4 py-3.5 bg-white/2 border-border-base">
      <div className="flex items-center gap-1 mb-2">
        <Icon size={14} strokeWidth={2} className="text-text-muted" />

        <Title4 text={label} />
      </div>
      <span
        className="font-(family-name:--font-ibm-plex-mono) text-[18px] font-bold tracking-tight block"
        style={{ color: valueColor ?? C.text }}
      >
        {value}
      </span>
      <span className="text-[11.5px] font-semibold mt-0.5 block text-text-muted">
        {sub}
      </span>
    </div>
  );
}
