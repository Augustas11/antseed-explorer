import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveEnsName } from "@/lib/ens";
import { resolveSearchDestination, resolveSearchMatches } from "@/lib/searchResolver";

export const dynamic = "force-dynamic";

interface SP {
  q?: string;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const query = await searchParams;
  const raw = (query.q ?? "").trim();
  const q = raw.toLowerCase();

  if (!q) {
    return (
      <div className="space-y-4 max-w-lg mx-auto mt-16">
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-muted text-sm">
          Search by address, channel id, ENS name, service name, or provider name.
        </p>
      </div>
    );
  }

  const destination = await resolveSearchDestination(raw);
  if (destination) redirect(destination);

  // Ethereum address (40 hex chars)
  if (/^0x[0-9a-f]{40}$/i.test(q)) {
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
        <Link href="/" className="btn">← Back to network</Link>
      </div>
    );
  }

  // ENS name (ends with .eth or contains a dot — resolves on mainnet)
  if (q.includes(".")) {
    const resolved = await resolveEnsName(q);
    if (resolved) {
      const resolvedDestination = await resolveSearchDestination(resolved);
      if (resolvedDestination) redirect(resolvedDestination);
      return (
        <div className="space-y-4 max-w-lg mx-auto mt-16">
          <h1 className="text-2xl font-semibold">Address not indexed</h1>
          <p className="text-muted text-sm">
            <span className="text-ink">{raw}</span> resolves to{" "}
            <code className="font-mono text-xs text-ink">{resolved}</code>, but
            this address has no AntSeed activity indexed yet.
          </p>
          <Link href="/" className="btn">← Back to network</Link>
        </div>
      );
    }
    return (
      <div className="space-y-4 max-w-lg mx-auto mt-16">
        <h1 className="text-2xl font-semibold">Name not found</h1>
        <p className="text-muted text-sm">
          <span className="text-ink">{raw}</span> did not resolve to an Ethereum address.
        </p>
        <Link href="/" className="btn">← Back to network</Link>
      </div>
    );
  }

  const matches = await resolveSearchMatches(raw, 8);
  if (matches.length > 0) {
    return (
      <div className="space-y-4 max-w-lg mx-auto mt-16">
        <h1 className="text-2xl font-semibold">Search results</h1>
        <div className="panel divide-y divide-edge">
          {matches.map((match) => (
            <Link
              key={`${match.type}:${match.href}`}
              href={match.href}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/5"
            >
              <span>
                <span className="block text-sm text-ink">{match.label}</span>
                <span className="block text-xs text-muted">{match.detail}</span>
              </span>
              <span className="text-xs text-accent">Open →</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  // Unrecognised format
  return (
    <div className="space-y-4 max-w-lg mx-auto mt-16">
      <h1 className="text-2xl font-semibold">No results</h1>
      <p className="text-muted text-sm">
        Nothing found for: <code className="font-mono text-ink">{raw}</code>
      </p>
      <p className="text-muted text-sm">The search bar accepts:</p>
      <ul className="text-muted text-sm list-disc list-inside space-y-1">
        <li>A 40-character Ethereum address (buyer or seller)</li>
        <li>A 64-character channel id</li>
        <li>An ENS name (e.g. <code className="font-mono text-ink">vitalik.eth</code>)</li>
        <li>A service name (e.g. <code className="font-mono text-ink">gpt-4o</code>)</li>
        <li>A provider display name</li>
      </ul>
      <Link href="/" className="btn">← Back to network</Link>
    </div>
  );
}
