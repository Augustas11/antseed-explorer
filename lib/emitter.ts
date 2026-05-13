export interface StreamEvent {
  type: string;
  txHash: string;
  blockNumber: number;
  buyerAddress: string | null;
  sellerAddress: string | null;
  channelId: string | null;
  deltaUsdc: number | null;
  timestamp: number;
}

type Listener = (event: StreamEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(event: StreamEvent): void {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {}
  }
}
