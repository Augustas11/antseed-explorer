import { CONTRACTS } from "./antseed";

export type LabelKind = "protocol" | "token" | "registry";

export interface AddressLabel {
  name: string;
  kind: LabelKind;
}

const LABEL_MAP: ReadonlyMap<string, AddressLabel> = new Map(
  (
    [
      [CONTRACTS.AntseedChannels, { name: "AntSeed: Channels", kind: "protocol" }],
      [CONTRACTS.AntseedRegistry, { name: "AntSeed: Registry", kind: "registry" }],
      [CONTRACTS.AntseedDeposits, { name: "AntSeed: Deposits", kind: "protocol" }],
      [CONTRACTS.AntseedStaking, { name: "AntSeed: Staking", kind: "protocol" }],
      [CONTRACTS.AntseedStats, { name: "AntSeed: Stats", kind: "protocol" }],
      [CONTRACTS.AntseedEmissions, { name: "AntSeed: Emissions", kind: "protocol" }],
      [CONTRACTS.ANTSToken, { name: "ANTS Token", kind: "token" }],
      [CONTRACTS.USDC, { name: "USDC (Circle)", kind: "token" }],
      [CONTRACTS.IdentityRegistry, { name: "AntSeed: Identity", kind: "registry" }],
    ] as const
  ).map(([addr, label]) => [addr.toLowerCase(), label]),
);

export function getLabel(address: string): AddressLabel | null {
  return LABEL_MAP.get(address.toLowerCase()) ?? null;
}

export const KIND_COLORS: Record<LabelKind, string> = {
  protocol: "badge-good",
  token: "badge-muted",
  registry: "badge-muted",
};
