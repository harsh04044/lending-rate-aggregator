import BN from "bn.js";
import * as Layout from "./buffer-layout";

import BufferLayout from "buffer-layout";

export interface LastUpdate {
  slot: BN;
  stale: boolean;
}

export const LastUpdateLayout: typeof BufferLayout.Structure =
  BufferLayout.struct(
    [Layout.uint64("slot"), BufferLayout.u8("stale")],
    "lastUpdate",
  );
