// Serve dist/ so the app can install from http://localhost:4600/index.json during development. CORS is open: the
// app fetches the index and bundles from the page itself (the NeetShelf Helper refuses loopback addresses).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 4600);
const TYPES: Record<string, string> = { ".json": "application/json", ".js": "text/javascript", ".png": "image/png", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join("dist", path === "/" ? "index.json" : path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`serving dist/ at http://localhost:${PORT}/index.json`));
