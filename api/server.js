import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { handleRequest } from "./core.js";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://zbi.babby").replace(/\/+$/, "");
const MAX_URL_LENGTH = Number(process.env.MAX_URL_LENGTH || 2048);
const MAX_BODY_LENGTH = 8192;
const DOCS_PATH = fileURLToPath(new URL("./docs.html", import.meta.url));

function readBody (req) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", chunk => {
      text += chunk;
      if (text.length > MAX_BODY_LENGTH) {
        reject(new Error("body too long"));
        req.destroy();
      }
    });
    req.on("end", () => resolve({ text, contentType: req.headers["content-type"] }));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let body = null;
  if (req.method === "POST") {
    try {
      body = await readBody(req);
    } catch (e) {
      res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify({ error: { code: "body_too_long", message: "Request body is too large." } })}\n`);
      return;
    }
  }

  const result = handleRequest({
    method: req.method,
    url,
    body,
    accept: req.headers.accept,
    publicUrl: PUBLIC_URL,
    maxUrlLength: MAX_URL_LENGTH,
    docsHtml: await readFile(DOCS_PATH, "utf8")
  });

  res.writeHead(result.status, result.headers);
  res.end(req.method === "HEAD" || result.body === null ? undefined : result.body);
}).listen(PORT, () => {
  console.log(`zbi.babby api listening on :${PORT}, public url ${PUBLIC_URL}`);
});
