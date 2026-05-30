import type {
  CollateralAsset,
  DebtAsset,
  JuplendPairPosition,
} from "@/app/(dashboard)/protocols/[slug]/page";
import { TokenIcon, TokenPairIcon } from "@/src/components/icons/token-icons";
import { Title3 } from "@/src/components/ui/title-3";

export function CollateralHeader({ asset }: { asset: CollateralAsset }) {
  return (
    <div className="flex items-center gap-4">
      <TokenIcon symbol={asset.symbol} logoUrl={asset.logoUrl} size={38} />
      <Title3 text={`Manage ${asset.symbol}`} />
    </div>
  );
}

export function DebtHeader({ asset }: { asset: DebtAsset }) {
  return (
    <div className="flex items-center gap-4">
      <TokenIcon symbol={asset.symbol} logoUrl={asset.logoUrl} size={38} />
      <Title3 text={`Manage ${asset.symbol}`} />
    </div>
  );
}

export function PairHeader({ pair }: { pair: JuplendPairPosition }) {
  const isCollateralOnly = pair.debtAmount === 0;
  if (isCollateralOnly) {
    return (
      <div className="flex items-center gap-4">
        <TokenIcon
          symbol={pair.collateralSymbol}
          logoUrl={pair.collateralLogoUrl}
          size={38}
        />
        <Title3 text={`Manage ${pair.collateralSymbol}`} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4">
      <TokenPairIcon
        collateralSymbol={pair.collateralSymbol}
        debtSymbol={pair.debtSymbol}
        collateralLogoUrl={pair.collateralLogoUrl}
        debtLogoUrl={pair.debtLogoUrl}
        size={38}
      />
      <Title3 text={`${pair.collateralSymbol} / ${pair.debtSymbol}`} />
    </div>
  );
}
