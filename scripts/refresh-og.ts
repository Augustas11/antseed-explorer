/**
 * refresh-og — verify the home OpenGraph card is fresh and refresh the social
 * caches that can actually be refreshed.
 *
 * Why this exists: the home card generates live metrics correctly (force-dynamic
 * page, no-store Neon reads, metric-versioned no-store /og/home image), but
 * social crawlers cache the unfurl per page URL for days. After a deploy or a
 * notable metrics change you may want to (a) confirm the live page advertises
 * the current numbers and (b) nudge the crawlers to re-scrape.
 *
 * What works programmatically:
 *   - Meta (Facebook / WhatsApp / Threads): Graph API scrape endpoint busts the
 *     cache on demand IF you provide META_GRAPH_TOKEN (a page/app access token).
 * What does NOT work programmatically (open the printed link and click refresh):
 *   - X / Twitter: the on-demand Card Validator was deprecated; there is no
 *     free token-less API to purge X's cache. X re-scrapes on its own ~weekly,
 *     or when you (re)share the link. The printed validator URL may still work
 *     interactively for some accounts.
 *   - LinkedIn: Post Inspector is interactive-only.
 *
 * Usage:
 *   npm run refresh-og                 # verify + print refresh links for the prod URL
 *   npm run refresh-og -- https://...  # target a specific URL (e.g. a preview)
 *   META_GRAPH_TOKEN=xxx npm run refresh-og   # also bust Meta's cache
 */

const DEFAULT_URL = "https://www.antfeed.org/";

async function main() {
  const target = process.argv[2] || DEFAULT_URL;
  console.log(`\nInspecting ${target}\n`);

  const html = await fetchText(target);
  const ogImage = metaContent(html, "og:image");
  const ogUrl = metaContent(html, "og:url");

  if (!ogImage) {
    console.error("✗ No og:image meta tag found — the page may not have rendered metadata.");
    process.exit(1);
  }

  console.log(`og:url    ${ogUrl ?? "(none)"}`);
  console.log(`og:image  ${ogImage}`);

  // Surface the metrics baked into the versioned image URL so you can eyeball
  // that the live card matches current network stats.
  const metrics = readMetrics(ogImage);
  if (metrics) {
    console.log(
      `metrics   buyers=${metrics.buyers} · usdc=${metrics.usdc} · sessions=${metrics.sessions} · v=${metrics.v}`,
    );
  }

  // Confirm the image endpoint actually serves an image and is not cached.
  const img = await fetchHead(ogImage);
  const ct = img.headers.get("content-type") ?? "";
  const cc = img.headers.get("cache-control") ?? "(none)";
  const ok = img.ok && ct.startsWith("image/");
  console.log(`image     ${img.status} · ${ct || "?"} · cache-control: ${cc}`);
  console.log(ok ? "✓ card image is live\n" : "✗ card image did not return an image\n");

  // The one URL the crawlers actually cache against is the page URL.
  const pageForCrawlers = ogUrl || target;

  // Meta: real, on-demand cache bust when a token is available.
  const token = process.env.META_GRAPH_TOKEN;
  if (token) {
    await bustMeta(pageForCrawlers, token);
  } else {
    console.log(
      "Meta      set META_GRAPH_TOKEN to auto-bust Facebook/WhatsApp/Threads cache.",
    );
  }

  // Interactive debuggers (open + click "refresh"/"scrape again").
  const enc = encodeURIComponent(pageForCrawlers);
  console.log("\nOpen these and trigger a re-scrape:");
  console.log(`  X / Twitter   https://cards-dev.twitter.com/validator   (paste: ${pageForCrawlers})`);
  console.log(`  Facebook      https://developers.facebook.com/tools/debug/?q=${enc}`);
  console.log(`  LinkedIn      https://www.linkedin.com/post-inspector/inspect/${enc}`);
  console.log(
    "\nNote: posts already shared on X keep their cached card until X re-scrapes" +
      " (~weekly) or you re-share the link. No API can purge it for you.\n",
  );

  if (!ok) process.exit(1);
}

async function bustMeta(url: string, token: string) {
  const endpoint = `https://graph.facebook.com/?id=${encodeURIComponent(
    url,
  )}&scrape=true&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(endpoint, { method: "POST" });
    const body = await res.text();
    console.log(
      `Meta      ${res.ok ? "✓ re-scraped" : "✗ failed"} (${res.status}) ${truncate(body, 200)}`,
    );
  } catch (err) {
    console.log(`Meta      ✗ request error: ${(err as Error).message}`);
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "antfeed-refresh-og/1.0" },
    redirect: "follow",
  });
  if (!res.ok) {
    console.error(`✗ ${url} returned ${res.status}`);
    process.exit(1);
  }
  return res.text();
}

async function fetchHead(url: string): Promise<Response> {
  // Use GET (some edge runtimes don't implement HEAD for generated images).
  return fetch(url, { headers: { "user-agent": "antfeed-refresh-og/1.0" } });
}

function metaContent(html: string, property: string): string | null {
  // Match <meta property="og:x" content="..."> in either attribute order.
  const esc = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = new RegExp(
    `<meta[^>]+(?:property|name)=["']${esc}["'][^>]*\\scontent=["']([^"']*)["']`,
    "i",
  ).exec(html);
  if (a) return a[1];
  const b = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${esc}["']`,
    "i",
  ).exec(html);
  return b ? b[1] : null;
}

function readMetrics(imageUrl: string) {
  try {
    const p = new URL(imageUrl).searchParams;
    if (!p.has("buyers")) return null;
    return {
      buyers: p.get("buyers"),
      usdc: p.get("usdc"),
      sessions: p.get("sessions"),
      v: p.get("v"),
    };
  } catch {
    return null;
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
