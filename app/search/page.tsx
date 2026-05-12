import { redirect } from "next/navigation";
import Link from "next/link";
import { lookupAddress } from "@/lib/queries";

export const dynamic = "force-dynamic";

interface SP {
  q?: string;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const raw = (searchParams.q ?? "").trim();
  const q = raw.toLowerCase();

  if (!q) {
    return (
      <div className="space-y-4 max-w-lg mx-auto mt-16">
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-muted text-sm">
          Paste a 40-character address (buyer or seller) or a 64-character
          channel id into the search bar above.
        </p>
      </div>
    );
  }

  // Channel id (64 hex chars)
  if (/^0x[0-9a-f]{64}$/i.test(q)) {
    redirect(`/channels/${q}`);
  }

  // Ethereum address (40 hex chars)
  if (/^0x[0-9a-f]{40}$/i.test(q)) {
    const result = await lookupAddress(q);
    if (result?.type === "buyer") redirect(`/buyers/${q}`);
    if (result?.type === "seller") redirect(`/sellers/${q}`);
    // Not indexed
    return (
      <div className="space-y-4 max-w-lg mx-auto mt-16">
        <h1 className="text-2xl font-semibold">Address not indexed</h1>
        <p className="text-muted text-sm">
          <code className="font-mono text-ink">{raw}</code>
        </p>
        <p className="text-muted text-sm">
          This address has no on-chain activity indexed on the AntSeed network
          yet. It may appear after the next sync.
        </p>
        <Link href="/" className="btn">
          ← Back to network
        </Link>
      </div>
    );
  }

  // Unrecognised format
  return (
    <div className="space-y-4 max-w-lg mx-auto mt-16">
      <h1 className="text-2xl font-semibold">Format not recognised</h1>
      <p className="text-muted text-sm">
        Searched for: <code className="font-mono text-ink">{raw}</code>
      </p>
      <p className="text-muted text-sm">The search bar accepts:</p>
      <ul className="text-muted text-sm list-disc list-inside space-y-1">
        <li>
          A 40-character Ethereum address (buyer or seller) — e.g.{" "}
          <code className="font-mono text-ink">0x1234…abcd</code>
        </li>
        <li>
          A 64-character channel id — e.g.{" "}
          <code className="font-mono text-ink">0xabcd…ef01</code>
        </li>
      </ul>
      <Link href="/" className="btn">
        ← Back to network
      </Link>
    </div>
  );
}
