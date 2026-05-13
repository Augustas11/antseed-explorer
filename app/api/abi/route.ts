import { channelsAbi } from "@/lib/antseed";

export const runtime = "nodejs";

export async function GET() {
  const json = JSON.stringify(channelsAbi, null, 2);
  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="antseed-channels-abi.json"',
      "Cache-Control": "public, max-age=86400",
    },
  });
}
