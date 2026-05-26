import { NextResponse } from "next/server";
import { invalidate } from "@/app/utils/cache";
import { Protocol } from "@/app/types/main";

const VALID_PROTOCOLS = new Set<Protocol>([
  Protocol.JupLend,
  Protocol.Drift,
  Protocol.Save,
  Protocol.Kamino,
]);

interface InvalidateBody {
  wallet?: string;
  protocols?: string[];
}

export async function POST(request: Request) {
  let body: InvalidateBody;
  try {
    body = (await request.json()) as InvalidateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { wallet, protocols } = body;
  if (!wallet || typeof wallet !== "string") {
    return NextResponse.json(
      { error: "Missing required field: wallet" },
      { status: 400 },
    );
  }

  // Validate the protocols list before passing in, so a bad client payload
  // can't smuggle unexpected values into the cache layer.
  let typedProtocols: Protocol[] | undefined;
  if (protocols && protocols.length > 0) {
    typedProtocols = [];
    for (const p of protocols) {
      if (!VALID_PROTOCOLS.has(p as Protocol)) {
        return NextResponse.json(
          { error: `Unknown protocol: ${p}` },
          { status: 400 },
        );
      }
      typedProtocols.push(p as Protocol);
    }
  }

  invalidate(wallet, typedProtocols);

  return NextResponse.json({ ok: true });
}
