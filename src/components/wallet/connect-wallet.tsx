"use client";

import { useState } from "react";
import { Wallet as WalletIcon } from "lucide-react";
import { ActionButton } from "@/src/components/ui/action-button";
import { MainCard } from "@/src/components/main-card";
import { Title3 } from "@/src/components/ui/title-3";
import { WalletPicker } from "./wallet-picker";

interface ConnectWalletGateProps {
  /** Short headline (e.g. "Connect your wallet"). */
  title?: string;
  /** Sub-line giving context for this page. */
  description?: string;
}

export function ConnectWalletGate({
  title = "Connect your wallet",
  description = "Connect a Solana wallet to view your positions and interact with the protocols.",
}: ConnectWalletGateProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex items-center justify-center py-16">
      <MainCard className="w-150 max-w-full">
        <div className="flex flex-col items-center text-center px-6 py-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-accent/10 border border-accent/25 mb-5">
            <WalletIcon size={26} strokeWidth={2} className="text-accent" />
          </div>
          <Title3 text={title} />
          <p className="mt-2 mb-6 max-w-md font-(family-name:--font-dm-sans) text-[13px] font-medium text-text-muted">
            {description}
          </p>
          <ActionButton
            onClick={() => setPickerOpen(true)}
            leadingIcon={<WalletIcon size={14} strokeWidth={2.2} />}
          >
            Connect wallet
          </ActionButton>
        </div>
      </MainCard>
      {pickerOpen && <WalletPicker onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
