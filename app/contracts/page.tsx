import type { Metadata } from "next";
import Link from "next/link";
import { CONTRACTS } from "@/lib/antseed";
import { getLabel, KIND_COLORS } from "@/lib/labels";
import { explorerBaseUrl } from "@/lib/chain";
import CopyButton from "../components/CopyButton";

export const metadata: Metadata = {
  title: "Contracts | AntSeed Demand Explorer",
  description: "AntSeed protocol contract addresses and ABI download.",
};

const CONTRACT_ENTRIES = Object.entries(CONTRACTS) as [string, string][];

export default function ContractsPage() {
  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Protocol Contracts</h1>
        <p className="text-muted text-sm mt-1">
          All AntSeed protocol contracts deployed on Base (chain id 8453).
        </p>
      </div>

      <section className="panel divide-y divide-edge/60">
        {CONTRACT_ENTRIES.map(([name, address]) => {
          const label = getLabel(address);
          return (
            <div key={address} className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink text-sm">{name}</span>
                  {label && (
                    <span className={`badge ${KIND_COLORS[label.kind]} !text-[10px] !px-1.5 !py-0`}>
                      {label.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs text-muted">{address}</code>
                  <CopyButton text={address} />
                </div>
              </div>
              <a
                href={`${explorerBaseUrl}/address/${address}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline shrink-0"
              >
                Basescan ↗
              </a>
            </div>
          );
        })}
      </section>

      <section className="panel p-5 space-y-3">
        <h2 className="font-medium">AntSeed Channels ABI</h2>
        <p className="text-muted text-sm">
          Download the verified ABI for the{" "}
          <code className="font-mono text-xs text-ink">AntseedChannels</code>{" "}
          contract to build integrations or call functions directly.
        </p>
        <div className="flex items-center gap-3">
          <a href="/api/abi" download="antseed-channels-abi.json" className="btn-accent">
            Download ABI JSON
          </a>
          <a
            href={`${explorerBaseUrl}/address/${CONTRACTS.AntseedChannels}#code`}
            target="_blank"
            rel="noreferrer"
            className="btn"
          >
            View on Basescan ↗
          </a>
        </div>
      </section>

      <div className="text-xs">
        <Link href="/" className="text-accent hover:underline">
          ← Back to network
        </Link>
      </div>
    </div>
  );
}
