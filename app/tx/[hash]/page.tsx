import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { decodeEventLog } from "viem";
import { publicClient, explorerBaseUrl } from "@/lib/chain";
import { channelsAbi, CONTRACTS } from "@/lib/antseed";
import { mapEventType, decodeMetadata } from "@/lib/indexer";
import { shortAddr, fmtUsd, fmtNum } from "@/lib/format";
import AddressDisplay from "../../components/AddressDisplay";
import TimestampDisplay from "../../components/TimestampDisplay";
import CopyButton from "../../components/CopyButton";

export const dynamic = "force-dynamic";

const USDC_DECIMALS = 1_000_000;
const channelsAddress = CONTRACTS.AntseedChannels.toLowerCase();

export async function generateMetadata({
  params,
}: {
  params: { hash: string };
}): Promise<Metadata> {
  return {
    title: `Tx ${params.hash.slice(0, 10)}… | AntSeed Explorer`,
    description: `Transaction details for ${params.hash}`,
  };
}

function eventSummary(eventType: string, args: Record<string, unknown>): string {
  const buyer = shortAddr(args.buyer as string | undefined);
  const seller = shortAddr(args.seller as string | undefined);
  switch (eventType) {
    case "reserved":
      return `Buyer ${buyer} opened a channel with ${seller} for up to ${fmtUsd(Number(args.maxAmount ?? 0n) / USDC_DECIMALS)} USDC`;
    case "settled": {
      const delta = Number(args.delta ?? 0n) / USDC_DECIMALS;
      const cumul = Number(args.cumulativeAmount ?? 0n) / USDC_DECIMALS;
      return `Buyer ${buyer} settled ${fmtUsd(delta)} USDC with ${seller} (cumulative: ${fmtUsd(cumul)})`;
    }
    case "closed": {
      const settled = Number(args.settledAmount ?? 0n) / USDC_DECIMALS;
      const refund = Number(args.refund ?? 0n) / USDC_DECIMALS;
      return `Channel closed — ${fmtUsd(settled)} USDC settled, ${fmtUsd(refund)} USDC refunded`;
    }
    case "topup": {
      const add = Number(args.additionalAmount ?? 0n) / USDC_DECIMALS;
      return `Buyer ${buyer} topped up channel by ${fmtUsd(add)} USDC`;
    }
    case "withdrawn": {
      const refund = Number(args.refund ?? 0n) / USDC_DECIMALS;
      return `Withdrawal of ${fmtUsd(refund)} USDC`;
    }
    case "close_requested": {
      const grace = args.gracePeriodEnd
        ? new Date(Number(args.gracePeriodEnd) * 1000).toUTCString()
        : "unknown";
      return `Close requested — grace period ends ${grace}`;
    }
    default:
      return `Protocol event: ${eventType}`;
  }
}

function eventTypePillClass(type: string): string {
  if (type === "settled") return "text-accent";
  if (type === "closed") return "text-muted";
  if (type === "reserved") return "text-ink";
  return "text-warn";
}

export default async function TxPage({
  params,
}: {
  params: { hash: string };
}) {
  const hash = params.hash as `0x${string}`;

  let tx: Awaited<ReturnType<typeof publicClient.getTransaction>>;
  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;

  try {
    [tx, receipt] = await Promise.all([
      publicClient.getTransaction({ hash }),
      publicClient.getTransactionReceipt({ hash }),
    ]);
  } catch {
    notFound();
  }

  let blockTs: number | null = null;
  try {
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    blockTs = Number(block.timestamp);
  } catch {}

  const decodedEvents: Array<{
    eventType: string;
    args: Record<string, unknown>;
    meta: ReturnType<typeof decodeMetadata>;
    logIndex: number;
  }> = [];

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== channelsAddress) continue;
    try {
      const decoded = decodeEventLog({
        abi: channelsAbi,
        data: log.data,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      });
      const eventType = mapEventType(decoded.eventName as string);
      if (!eventType) continue;
      const args = decoded.args as Record<string, unknown>;
      const meta =
        eventType === "settled"
          ? decodeMetadata(args.metadata as string | undefined)
          : null;
      decodedEvents.push({ eventType, args, meta, logIndex: log.logIndex });
    } catch {}
  }

  const gasUsed = Number(receipt.gasUsed);
  const gasPrice = tx.gasPrice ? Number(tx.gasPrice) : 0;
  const feeEth = (gasUsed * gasPrice) / 1e18;
  const gasPriceGwei = gasPrice / 1e9;
  const success = receipt.status === "success";

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <div className="text-xs uppercase tracking-wider text-muted">Transaction</div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <code className="font-mono text-sm text-ink break-all">{hash}</code>
          <CopyButton text={hash} />
          <span className={`pill text-xs ${success ? "text-accent" : "text-red-400"}`}>
            {success ? "Success" : "Failed"}
          </span>
        </div>
      </div>

      {/* Info table */}
      <section className="panel divide-y divide-edge/60">
        <InfoRow label="Block">
          <a
            href={`${explorerBaseUrl}/block/${receipt.blockNumber}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline font-mono text-sm"
          >
            {Number(receipt.blockNumber).toLocaleString()} ↗
          </a>
        </InfoRow>
        <InfoRow label="Timestamp">
          <TimestampDisplay ts={blockTs} />
        </InfoRow>
        <InfoRow label="From">
          <AddressDisplay address={tx.from} />
        </InfoRow>
        <InfoRow label="To">
          {tx.to ? (
            <AddressDisplay address={tx.to} />
          ) : (
            <span className="text-muted text-xs">Contract creation</span>
          )}
        </InfoRow>
        <InfoRow label="Gas used">
          <span className="font-mono text-sm">{gasUsed.toLocaleString()}</span>
        </InfoRow>
        <InfoRow label="Gas price">
          <span className="font-mono text-sm">{gasPriceGwei.toFixed(4)} Gwei</span>
        </InfoRow>
        <InfoRow label="Tx fee">
          <span className="font-mono text-sm">{feeEth.toFixed(8)} ETH</span>
        </InfoRow>
        <InfoRow label="Basescan">
          <a
            href={`${explorerBaseUrl}/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline text-sm"
          >
            View full transaction ↗
          </a>
        </InfoRow>
      </section>

      {/* AntSeed protocol events */}
      {decodedEvents.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-medium">AntSeed Protocol Events</h2>
          {decodedEvents.map((ev) => {
            const args = ev.args;
            const buyer = (args.buyer as string | undefined)?.toLowerCase();
            const seller = (args.seller as string | undefined)?.toLowerCase();
            const channelId = args.channelId as string | undefined;

            return (
              <div key={ev.logIndex} className="panel p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <span className={`pill text-xs shrink-0 ${eventTypePillClass(ev.eventType)}`}>
                    {ev.eventType}
                  </span>
                  <p className="text-sm text-ink">{eventSummary(ev.eventType, args)}</p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  {channelId && (
                    <Field
                      label="Channel ID"
                      value={
                        <code className="font-mono text-xs break-all">
                          {shortAddr(channelId, 10, 8)}
                        </code>
                      }
                    />
                  )}
                  {buyer && (
                    <Field
                      label="Buyer"
                      value={
                        <Link
                          href={`/buyers/${buyer}`}
                          className="text-accent hover:underline font-mono text-xs"
                        >
                          {shortAddr(buyer)}
                        </Link>
                      }
                    />
                  )}
                  {seller && (
                    <Field
                      label="Seller"
                      value={
                        <Link
                          href={`/sellers/${seller}`}
                          className="text-accent hover:underline font-mono text-xs"
                        >
                          {shortAddr(seller)}
                        </Link>
                      }
                    />
                  )}
                  {args.maxAmount !== undefined && (
                    <Field label="Max amount" value={fmtUsd(Number(args.maxAmount as bigint) / USDC_DECIMALS)} />
                  )}
                  {args.delta !== undefined && (
                    <Field label="Delta" value={fmtUsd(Number(args.delta as bigint) / USDC_DECIMALS)} />
                  )}
                  {args.cumulativeAmount !== undefined && (
                    <Field label="Cumulative" value={fmtUsd(Number(args.cumulativeAmount as bigint) / USDC_DECIMALS)} />
                  )}
                  {args.totalSettled !== undefined && (
                    <Field label="Total settled" value={fmtUsd(Number(args.totalSettled as bigint) / USDC_DECIMALS)} />
                  )}
                  {args.settledAmount !== undefined && (
                    <Field label="Settled" value={fmtUsd(Number(args.settledAmount as bigint) / USDC_DECIMALS)} />
                  )}
                  {args.refund !== undefined && (
                    <Field label="Refund" value={fmtUsd(Number(args.refund as bigint) / USDC_DECIMALS)} />
                  )}
                  {args.additionalAmount !== undefined && (
                    <Field label="Top-up" value={fmtUsd(Number(args.additionalAmount as bigint) / USDC_DECIMALS)} />
                  )}
                  {args.newDeposit !== undefined && (
                    <Field label="New deposit" value={fmtUsd(Number(args.newDeposit as bigint) / USDC_DECIMALS)} />
                  )}
                  {args.platformFee !== undefined && (
                    <Field label="Platform fee" value={fmtUsd(Number(args.platformFee as bigint) / USDC_DECIMALS)} />
                  )}
                  {ev.meta && (
                    <>
                      <Field label="Input tokens" value={fmtNum(ev.meta.inputTokens)} />
                      <Field label="Output tokens" value={fmtNum(ev.meta.outputTokens)} />
                      <Field label="Requests" value={fmtNum(ev.meta.requestCount)} />
                    </>
                  )}
                </div>

                <div className="flex gap-4 text-xs pt-1 border-t border-edge">
                  {buyer && (
                    <Link href={`/buyers/${buyer}`} className="text-accent hover:underline">
                      View buyer →
                    </Link>
                  )}
                  {seller && (
                    <Link href={`/sellers/${seller}`} className="text-accent hover:underline">
                      View seller →
                    </Link>
                  )}
                  {channelId && (
                    <Link href={`/channels/${channelId}`} className="text-accent hover:underline">
                      View channel →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Raw logs collapsible */}
      <details className="panel">
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium select-none">
          Raw logs ({receipt.logs.length})
        </summary>
        <div className="divide-y divide-edge/40">
          {receipt.logs.map((log) => (
            <div key={log.logIndex} className="px-4 py-3 text-xs font-mono">
              <div>
                <span className="text-muted">Address: </span>
                <span className="text-ink">{log.address}</span>
              </div>
              <div>
                <span className="text-muted">Topics: </span>
                <span className="text-ink">{log.topics.length}</span>
              </div>
              {log.topics[0] && (
                <div className="truncate">
                  <span className="text-muted">Sig: </span>
                  <span className="text-ink">{log.topics[0]}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </details>

      <div className="text-xs">
        <Link href="/" className="text-accent hover:underline">
          ← back to home
        </Link>
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-5 py-3 flex items-start gap-4 flex-wrap">
      <span className="text-muted text-sm w-28 shrink-0">{label}</span>
      <span className="text-ink text-sm flex-1 min-w-0">{children}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-ink text-sm">{value}</div>
    </div>
  );
}
