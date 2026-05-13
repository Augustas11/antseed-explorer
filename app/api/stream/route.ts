import { subscribe } from "@/lib/emitter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encode(": connected\n\n"));

      unsubscribe = subscribe((event) => {
        try {
          controller.enqueue(encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {}
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function encode(s: string) {
  return new TextEncoder().encode(s);
}
