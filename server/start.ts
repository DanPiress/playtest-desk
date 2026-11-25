// Production server: serves the built app from dist/ and the suggestion endpoint.
// Run `npm run build` first, then `npm start`. Needs Node.js 22.18 or later (runs TypeScript directly).
// Set ANTHROPIC_API_KEY in the environment (or .env.local) to turn on AI suggestions.
import { createServer, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSuggestHandler } from "./suggest-api.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "dist");

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(join(root, file));
  } catch {
    /* optional */
  }
}

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || "127.0.0.1";
const key = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
const api = createSuggestHandler(() => key);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

async function serveFile(path: string, res: ServerResponse, status = 200) {
  const body = await readFile(path);
  res.statusCode = status;
  res.setHeader("content-type", TYPES[extname(path)] ?? "application/octet-stream");
  res.setHeader("cache-control", path.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
  res.end(body);
}

const server = createServer((req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  api(req, res, async () => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("allow", "GET, HEAD");
      return res.end();
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      const target = normalize(join(dist, pathname));
      if (target !== dist && !target.startsWith(dist + sep)) {
        res.statusCode = 400;
        return res.end();
      }
      const info = await stat(target).catch(() => null);
      if (info?.isFile()) return await serveFile(target, res);
      if (pathname.startsWith("/api/") || extname(pathname)) {
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        return res.end("Not found");
      }
      return await serveFile(join(dist, "index.html"), res);
    } catch {
      res.statusCode = 500;
      res.end();
    }
  });
});

server.listen(port, host, () => {
  console.log(`Playtest Desk on http://${host}:${port} (suggestions: ${key ? "AI" : "sample mode"})`);
});
