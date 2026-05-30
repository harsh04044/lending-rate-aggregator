import { TokenIcon } from "@/src/components/icons/token-icons";
import { Title4 } from "@/src/components/ui/title-4";

export interface AmountFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  symbol: string;
  logoUrl?: string;
  hint?: string;
  onMax?: () => void;
}

// Two-column wrapper used for every modal layout (per-asset and per-pair).
// Left/right are independent inputs; each leg owns its own onChange/onMax.
export function PairedAmountInputs({
  left,
  right,
}: {
  left: AmountFieldProps;
  right: AmountFieldProps;
}) {
  return (
    <div className="grid grid-cols-2 gap-5">
      <AmountField {...left} />
      <AmountField {...right} />
    </div>
  );
}

export function AmountField({
  label,
  value,
  onChange,
  symbol,
  logoUrl,
  hint,
  onMax,
}: AmountFieldProps) {
  return (
    <div>
      <div className="mb-2">
        <Title4 text={label} />
      </div>
      <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
        <TokenIcon symbol={symbol} logoUrl={logoUrl} size={24} />
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
          }}
          className="flex-1 min-w-0 bg-transparent font-(family-name:--font-ibm-plex-mono) text-[18px] font-medium outline-none placeholder:opacity-30 text-text-base"
        />
        {onMax && (
          <button
            type="button"
            onClick={onMax}
            className="p-2 cursor-pointer bg-surface-2 rounded-sm font-(family-name:--font-dm-sans) text-[12px] font-bold shrink-0 text-text-muted"
          >
            MAX
          </button>
        )}
      </div>
      {hint && (
        <p className="font-(family-name:--font-ibm-plex-mono) text-[12px] mt-1.5 px-1 font-semibold text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
