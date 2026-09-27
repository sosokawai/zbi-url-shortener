import assert from "node:assert/strict";

const base = (process.env.BASE_URL || "http://localhost:8080").replace(/\/+$/, "");
const results = [];

async function test (name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e });
    console.log(`  FAIL ${name}\n       ${e.message.split("\n")[0]}`);
  }
}

const get = (path, init) => fetch(`${base}${path}`, { redirect: "manual", ...init });
const short = (url, extra = "") => get(`/api/v1/shorten?url=${encodeURIComponent(url)}${extra}`).then(r => r.json());
const DISCORD_UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

console.log(`api tests against ${base}\n`);

await test("health answers json", async () => {
  const r = await get("/api/v1/health");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /application\/json/);
  assert.equal((await r.json()).status, "ok");
});

await test("docs page is served at /api", async () => {
  const r = await get("/api");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.match(await r.text(), /zbi\.babby api/);
});

for (const mode of ["hash", "emoji", "qr"]) {
  await test(`shorten roundtrips in ${mode} mode`, async () => {
    const target = "https://www.amazon.com/dp/B0CX23V2ZK/ref=sr_1_1?keywords=widget&qid=1720000000";
    const { short: link } = await short(target, `&mode=${mode}`);
    assert.ok(link.startsWith("https://zbi.babby"), `link is on the right host: ${link}`);
    const back = await get(`/api/v1/expand?link=${encodeURIComponent(link)}&format=text`);
    assert.equal((await back.text()).trim(), target);
  });
}

await test("format=text returns one bare link", async () => {
  const r = await get(`/api/v1/shorten?url=${encodeURIComponent("https://example.com/some/long/path")}&format=text`);
  assert.match(r.headers.get("content-type"), /text\/plain/);
  const body = (await r.text()).trim();
  assert.equal(body.split("\n").length, 1);
  assert.ok(body.startsWith("https://zbi.babby#"));
});

await test("Accept: text/plain returns text", async () => {
  const r = await get(`/api/v1/shorten?url=${encodeURIComponent("https://example.com/x")}`, {
    headers: { accept: "text/plain" }
  });
  assert.match(r.headers.get("content-type"), /text\/plain/);
  assert.ok((await r.text()).trim().startsWith("https://zbi.babby#"));
});

await test("cors is open for browser clients", async () => {
  const r = await get("/api/v1/shorten", {
    method: "OPTIONS",
    headers: { origin: "https://discord.com", "access-control-request-method": "POST" }
  });
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.match(r.headers.get("access-control-allow-methods") || "", /POST/);
});

await test("a discord bot user agent is served like anyone else", async () => {
  const r = await get(`/api/v1/shorten?url=${encodeURIComponent("https://example.com/from/discord")}`, {
    headers: { "user-agent": DISCORD_UA }
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.short.startsWith("https://zbi.babby#"));
  const back = await get(`/api/v1/expand?link=${encodeURIComponent(body.short)}&format=text`, {
    headers: { "user-agent": DISCORD_UA }
  });
  assert.equal((await back.text()).trim(), "https://example.com/from/discord");
});

await test("a bot with no user agent at all still works", async () => {
  const r = await fetch(`${base}/api/v1/shorten?url=${encodeURIComponent("https://example.com/no/ua")}`, {
    headers: { "user-agent": "" }
  });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).short);
});

await test("post as json, the way a discord bot would", async () => {
  const r = await get("/api/v1/shorten", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/post/json" })
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  const back = await get(`/api/v1/expand?payload=${encodeURIComponent(body.payload)}&format=text`);
  assert.equal((await back.text()).trim(), "https://example.com/post/json");
});

await test("post as a form", async () => {
  const r = await get("/api/v1/shorten", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "url=https://example.com/post/form"
  });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).short);
});

await test("qr links live in the path so a preview can see them", async () => {
  const { short: link } = await short("https://example.com/qr/in/a/path", "&mode=qr");
  assert.ok(link.startsWith("https://zbi.babby/"), link);
  assert.ok(!link.includes("#"));
  const back = await get(`/api/v1/expand?link=${encodeURIComponent(link)}&format=text`);
  assert.equal((await back.text()).trim(), "https://example.com/qr/in/a/path");
});

await test("error codes come back with the right status", async () => {
  const cases = [
    ["/api/v1/shorten", 400, "missing_url"],
    ["/api/v1/shorten?url=ftp%3A%2F%2Fx.com%2Fa", 400, "unsupported_protocol"],
    ["/api/v1/shorten?url=https%3A%2F%2Fu%3Ap%40x.com%2Fa", 400, "credentials_not_supported"],
    ["/api/v1/shorten?url=https%3A%2F%2Fx.com&mode=nope", 400, "unknown_mode"],
    ["/api/v1/expand", 400, "missing_link"],
    ["/api/v1/expand?payload=%25%25%25nope", 400, "undecodable"],
    ["/api/v1/nope", 404, "not_found"]
  ];
  for (const [path, status, code] of cases) {
    const r = await get(path);
    assert.equal(r.status, status, `${path} status`);
    assert.equal((await r.json()).error.code, code, `${path} code`);
  }
});

await test("a link over the limit is refused", async () => {
  const long = `https://example.com/${"a".repeat(2100)}`;
  const r = await get(`/api/v1/shorten?url=${encodeURIComponent(long)}`);
  assert.equal(r.status, 414);
  assert.equal((await r.json()).error.code, "url_too_long");
});

await test("bad json gets a readable error, not a stack trace", async () => {
  const r = await get("/api/v1/shorten", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{oops"
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, "invalid_json");
});

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed against ${base}`);
if (failed.length) {
  console.log("\nfailures:");
  for (const f of failed) console.log(`  ${f.name}: ${f.error.message}`);
  process.exit(1);
}
