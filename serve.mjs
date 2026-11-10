// ローカル確認用の最小サーバー。docs/ を配信するだけ。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".csv": "text/csv; charset=utf-8", ".py": "text/plain; charset=utf-8" };

createServer(async (req, res) => {
  let url = req.url.split("?")[0];
  if (url.endsWith("/")) url += "index.html";
  try {
    const body = await readFile(join("docs", decodeURIComponent(url)));
    res.writeHead(200, { "content-type": TYPES[extname(url)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}).listen(8080, () => console.log("http://localhost:8080"));
