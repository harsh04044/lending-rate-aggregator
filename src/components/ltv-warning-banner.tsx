import { AlertTriangle } from "lucide-react";

export function LtvWarningBanner({
  requiredLtv,
  maxLtv,
  protocolName,
  collateral,
  debt,
  title,
  onReduceBorrow,
  onAddCollateral,
}: {
  requiredLtv: string;
  maxLtv: number;
  protocolName: string;
  collateral: string;
  debt: string;
  title?: string;
  onReduceBorrow?: () => void;
  onAddCollateral?: () => void;
}) {
  return (
    <div className="rounded-lg border-warn/18 bg-warn/4 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-6 h-6 rounded-sm flex items-center justify-center shrink-0 bg-warn/10">
          <AlertTriangle size={12} strokeWidth={2.2} className="text-warn" />
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="font-(family-name:--font-dm-sans) text-[14px] font-bold text-warn">
            {title ?? `Position exceeds ${protocolName}'s supported LTV`}
          </span>
          <p className="font-(family-name:--font-dm-sans) text-[12px] font-semibold leading-relaxed text-[#A08A60]">
            This position requires {requiredLtv} LTV, but {protocolName}{" "}
            supports a maximum of {maxLtv}% for {collateral}/{debt}. Reduce the
            borrow amount or add more collateral to continue.
          </p>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-4">
              <span className="font-(family-name:--font-ibm-plex-mono) font-semibold text-[12px] text-[#8A7A55]">
                Current LTV:{" "}
                <span className="font-bold text-warn">{requiredLtv}%</span>
              </span>
              <span className="font-(family-name:--font-ibm-plex-mono) font-semibold text-[12px] text-[#8A7A55]">
                Max Allowed:{" "}
                <span className="font-bold text-text-dim">{maxLtv}%</span>
              </span>
            </div>
            {(onReduceBorrow || onAddCollateral) && (
              <div className="flex items-center gap-2 ml-auto">
                {onReduceBorrow && (
                  <button
                    type="button"
                    onClick={onReduceBorrow}
                    className="font-(family-name:--font-dm-sans) text-[10px] font-semibold cursor-pointer px-2 py-0.5 rounded text-warn bg-warn/8 border border-warn/15"
                  >
                    Reduce Borrow
                  </button>
                )}
                {onAddCollateral && (
                  <button
                    type="button"
                    onClick={onAddCollateral}
                    className="font-(family-name:--font-dm-sans) text-[10px] font-semibold cursor-pointer px-2 py-0.5 rounded text-warn bg-warn/8 border border-warn/15"
                  >
                    Add More Collateral
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
