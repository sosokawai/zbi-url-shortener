import { compress, decompress } from "../docs/compress.js";
import {
  outputAlphabetASCII,
  outputAlphabetQR,
  outputAlphabetEmoji
} from "../docs/alphabets.js";

const ALPHABETS = {
  hash: outputAlphabetASCII,
  emoji: outputAlphabetEmoji,
  qr: outputAlphabetQR
};

export const ENDPOINTS = [
  { method: "GET, POST", path: "/api/v1/shorten", summary: "Compress a link." },
  { method: "GET", path: "/api/v1/expand", summary: "Unpack a short link." },
  { method: "GET", path: "/api/v1/health", summary: "Liveness check." },
  { method: "GET", path: "/api/v1", summary: "This list, as JSON." }
];

export class ApiError extends Error {
  constructor (status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalizeInput (raw, maxUrlLength) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ApiError(400, "missing_url", "No link given. Pass ?url=... or a JSON body of {\"url\": \"...\"}.");
  }
  const input = raw.trim();
  if (input.length > maxUrlLength) {
    throw new ApiError(414, "url_too_long", `Links are limited to ${maxUrlLength} characters, got ${input.length}.`);
  }
  const hasProtocol = /\w+:\/\//.test(input);
  let url;
  try {
    url = new URL(hasProtocol ? input : `http://${input}`);
  } catch (e) {
    throw new ApiError(400, "invalid_url", "That is not a link this service can understand.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "unsupported_protocol", `Only http and https links can be compressed, got "${url.protocol}".`);
  }
  if (url.username || url.password) {
    throw new ApiError(400, "credentials_not_supported", "Links containing credentials are not supported.");
  }
  return input;
}

export function shorten (rawUrl, mode, publicUrl, maxUrlLength) {
  const input = normalizeInput(rawUrl, maxUrlLength);
  const alphabet = ALPHABETS[mode];
  if (!alphabet) {
    throw new ApiError(400, "unknown_mode", `Unknown mode "${mode}". Use one of: ${Object.keys(ALPHABETS).join(", ")}.`);
  }
  const payload = compress(input, alphabet);
  const short = mode === "qr" ? `${publicUrl}/${payload}` : `${publicUrl}#${payload}`;
  return {
    input,
    short,
    payload,
    mode,
    input_length: input.length,
    payload_length: payload.length,
    short_length: short.length,
    shorter_percent: Math.round((1 - short.length / input.length) * 100)
  };
}

export function expand (rawLink, publicUrl) {
  if (typeof rawLink !== "string" || !rawLink.trim()) {
    throw new ApiError(400, "missing_link", "No short link given. Pass ?link=https://zbi.baby#...");
  }
  let payload = rawLink.trim();
  const host = publicUrl.toLowerCase();
  const lower = payload.toLowerCase();
  let isQr = payload.startsWith("/");
  if (lower.startsWith(`${host}/`)) {
    // keep the slash, it is what marks a qr link
    payload = payload.slice(host.length);
    isQr = true;
  } else if (lower.startsWith(`${host}#`)) {
    payload = payload.slice(host.length + 1);
  }
  if (isQr) payload = payload.slice(1);
  try {
    const useEmoji = Array.from(payload).some(c => !outputAlphabetASCII.includes(c));
    return decompress(payload, isQr ? outputAlphabetQR : useEmoji ? outputAlphabetEmoji : outputAlphabetASCII);
  } catch (e) {
    throw new ApiError(400, "undecodable", "That payload is not something this service can unpack.");
  }
}

function wantsText (url, accept) {
  const format = url.searchParams.get("format");
  if (format === "text" || format === "txt" || format === "plain") return true;
  if (format === "json") return false;
  return (accept || "").includes("text/plain");
}

function reply (body, type) {
  return {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Content-Type-Options": "nosniff"
    },
    body
  };
}

function json (data) {
  return reply(`${JSON.stringify(data, null, 2)}\n`, "application/json; charset=utf-8");
}

function paramsFrom (method, url, body) {
  if (method !== "POST" || !body) return url.searchParams;
  const type = (body.contentType || "").split(";")[0].trim();
  if (type === "application/json") {
    let parsed;
    try {
      parsed = JSON.parse(body.text);
    } catch (e) {
      throw new ApiError(400, "invalid_json", "Body is not valid JSON.");
    }
    return new URLSearchParams(Object.entries(parsed).map(([k, v]) => [k, v]));
  }
  if (type === "application/x-www-form-urlencoded" || !type) {
    return new URLSearchParams(body.text);
  }
  throw new ApiError(415, "unsupported_media_type", `Cannot read a "${type}" body. Use JSON or form encoding.`);
}

export function handleRequest ({ method, url, body, accept, publicUrl, maxUrlLength, docsHtml }) {
  if (method === "OPTIONS") {
    return { status: 204, headers: reply("", "text/plain").headers, body: null };
  }

  try {
    if (url.pathname === "/api" || url.pathname === "/api/" || url.pathname === "/api/index.html") {
      if (wantsText(url, accept)) {
        return json({ service: "zbi.baby", public_url: publicUrl, endpoints: ENDPOINTS });
      }
      return reply(docsHtml, "text/html; charset=utf-8");
    }

    if (url.pathname === "/api/v1" || url.pathname === "/api/v1/") {
      return json({ service: "zbi.baby", public_url: publicUrl, endpoints: ENDPOINTS });
    }

    if (url.pathname === "/api/v1/health") {
      return json({ status: "ok", public_url: publicUrl });
    }

    if (url.pathname === "/api/v1/shorten") {
      if (method !== "GET" && method !== "POST" && method !== "HEAD") {
        throw new ApiError(405, "method_not_allowed", "Use GET or POST.");
      }
      const params = paramsFrom(method, url, body);
      const result = shorten(params.get("url"), (params.get("mode") || "hash").toLowerCase(), publicUrl, maxUrlLength);
      if (wantsText(url, accept)) {
        return reply(`${result.short}\n`, "text/plain; charset=utf-8");
      }
      return json(result);
    }

    if (url.pathname === "/api/v1/expand") {
      const result = expand(url.searchParams.get("link") || url.searchParams.get("payload"), publicUrl);
      if (wantsText(url, accept)) {
        return reply(`${result}\n`, "text/plain; charset=utf-8");
      }
      return json({ url: result });
    }

    throw new ApiError(404, "not_found", `Nothing at ${url.pathname}. See ${publicUrl}/api.`);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "internal_error";
    const message = status === 500 ? "Something broke on this end." : error.message;
    if (status === 500) console.error(error);
    if (wantsText(url, accept)) {
      return { ...reply(`${message}\n`, "text/plain; charset=utf-8"), status };
    }
    return { ...json({ error: { code, message } }), status };
  }
}
