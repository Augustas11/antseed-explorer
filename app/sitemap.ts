import type { MetadataRoute } from "next";
import { listBuyers } from "@/lib/queries";

const SITE = "https://www.antfeed.org";

// Refresh once per hour — buyer set churns slowly and a stale entry is
// cheaper than hitting Neon on every crawler request. force-dynamic prevents
// Next from trying to enumerate buyers at build time when DATABASE_URL is
// only available at runtime on Vercel.
export const dynamic = "force-dynamic";
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const buyers = await listBuyers({ limit: 1000, sort: "score" });
  const now = new Date();
  const buyerUrls: MetadataRoute.Sitemap = buyers.map((b) => ({
    url: `${SITE}/buyers/${b.address}`,
    lastModified: b.last_seen_ts ? new Date(b.last_seen_ts * 1000) : now,
    changeFrequency: "daily",
    priority: 0.5,
  }));
  return [
    { url: SITE, lastModified: now, changeFrequency: "hourly", priority: 1.0 },
    { url: `${SITE}/buyers`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    ...buyerUrls,
  ];
}
