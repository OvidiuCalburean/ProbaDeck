const pages = ["/", "/docs/", "/examples/"] as const;

export function GET({ site }: { readonly site: URL | undefined }) {
  if (site === undefined) throw new Error("Astro site URL is required to build the sitemap");
  const urls = pages
    .map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`)
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
