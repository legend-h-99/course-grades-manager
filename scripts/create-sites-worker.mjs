import { mkdir, writeFile } from "node:fs/promises";

const worker = `const cacheHeaders = {
  "Cache-Control": "public, max-age=31536000, immutable"
};

function withHeaders(response, headers) {
  const nextHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) nextHeaders.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: nextHeaders });
}

async function fetchAsset(env, request, path) {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = "";
  return env.ASSETS.fetch(new Request(url, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const assetResponse = await fetchAsset(env, request, url.pathname);

    if (assetResponse.status !== 404) {
      return url.pathname.startsWith("/assets/")
        ? withHeaders(assetResponse, cacheHeaders)
        : assetResponse;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Not found", { status: 404 });
    }

    const indexResponse = await fetchAsset(env, request, "/index.html");
    return withHeaders(indexResponse, { "Cache-Control": "no-store" });
  }
};
`;

await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/index.js", worker);
