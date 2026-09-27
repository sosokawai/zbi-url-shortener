# zbi.baby

A URL shortener that has no database. The whole shortened link is squeezed into
the address itself, so nothing is ever stored, nothing can leak, and there is no
key to sign up for.

Live at **zbi.baby**, with a JSON API at **zbi.baby/api** for bots and scripts.

This is a fork of [ha.mr](https://github.com/p2r3/ha.mr) by p2r3, which did all
the hard work. See [what changed here](#what-changed-here) and
[how it works](#how-it-works).

## Deploying

The site is a static bundle, the api is a Cloudflare Worker.

```sh
npm install          # wrangler, for the deploy commands
npx wrangler login

npm run deploy:site  # docs/ -> Cloudflare Pages
npm run deploy:api   # api/worker.js -> Cloudflare Workers
```

- **Pages** serves `docs/`. Attach `zbi.baby` as a custom domain in the project
  settings. `docs/CNAME` holds the same name for the git-based flow.
- **Workers** serves `/api` on the same hostname, so the site can link to `/api`
  and a bot only needs one domain. The route, the zone and the variables
  (`PUBLIC_URL`, `MAX_URL_LENGTH`) are all in `wrangler.toml`.
- `npm run dev` runs the Worker on :8787, which is the quickest way to check a
  change before deploying it.

If Pages takes `/api` back on your zone, give the Worker its own subdomain:
change `pattern` to `api.zbi.baby/*`, attach that as a custom domain, and point
the `API` link in `docs/404.html` at it.

## Running it locally

```sh
docker compose up -d --build   # site on :8080, api behind it
```

Two containers: `web` (nginx, serves `docs/`) and `api` (node, no dependencies,
serves `/api/*`). Without docker, just the api:

```sh
npm start                       # or: PUBLIC_URL=https://zbi.baby node api/server.js
```

| variable | default | what it does |
| --- | --- | --- |
| `PORT` | `3000` | port the node server listens on |
| `PUBLIC_URL` | `https://zbi.baby` | host used in the links that get returned |
| `MAX_URL_LENGTH` | `2048` | reject longer links with a `414` |

## API

Everything is stateless, so `shorten` and `expand` are pure functions of their
input: no key to register for, no table to wipe between restarts. `GET /api`
serves the same documentation in a browser, with a box to try it in.

```sh
# compress, json out
curl -G "https://zbi.baby/api/v1/shorten" \
  --data-urlencode "url=https://www.amazon.com/dp/B0CX23V2ZK/ref=sr_1_1?keywords=widget&qid=1720000000"

# --data-urlencode is what keeps the ? and & in the link from being read as
# parameters of the api call itself

# one line of text, for bots
curl -G "https://zbi.baby/api/v1/shorten" --data-urlencode "url=https://example.com/x" -d "format=text"
curl -H "Accept: text/plain" "https://zbi.baby/api/v1/shorten?url=https://example.com/x"

# post instead, json or form encoded
curl -X POST https://zbi.baby/api/v1/shorten \
  -H "Content-Type: application/json" -d '{"url":"https://example.com/x"}'
curl -X POST https://zbi.baby/api/v1/shorten -d "url=https://example.com/x"

# unpack, with the # percent encoded
curl -G "https://zbi.baby/api/v1/expand" \
  --data-urlencode "link=https://zbi.baby#OQ/ap#"

# health
curl https://zbi.baby/api/v1/health
```

`mode` picks the flavour: `hash` (default, payload in the fragment), `emoji`
(payload in the fragment, as emoji) or `qr` (payload in the path, so it survives
being printed as a QR code). It works on `expand` too, where a bare `qr` payload
needs `mode=qr` or a leading `/` to be told apart from a text payload, and
without one of those the api answers `400 ambiguous_payload` rather than guess.
Errors answer with a matching status and a code — `unsupported_protocol`,
`url_too_long`, `undecodable` and friends. CORS is open.

### From a Discord bot

One GET, no key, nothing to sign up for:

```py
# discord.py
response = requests.get(
    "https://zbi.baby/api/v1/shorten",
    params={"url": url, "mode": "qr"},
    headers={"Accept": "text/plain"},
    timeout=5,
)
response.raise_for_status()
await ctx.send(response.text.strip())
```

Ask for `mode=qr` in a chat bot. A `#fragment` link never reaches a server, so
Discord's preview crawler (and anything else that fetches the link) only sees
`zbi.baby`; a path link is decodable by anything.

### Testing it

```sh
npm test                                  # against the local compose stack
BASE_URL=https://zbi.baby npm test        # against what is actually deployed
```

19 checks covering all three modes, JSON and form posts, CORS, every error
code, and requests made with a Discord bot user agent, no user agent, and a
`text/plain` accept header.

## CLI

```sh
node standalone.js https://example.com/some/long/path    # encode
node standalone.js "https://zbi.baby#OQ/ap#"              # decode, quotes matter
node standalone.js https://example.com/some/long/path qr  # qr alphabet, no fragment
```

## What changed here

Everything upstream does still works, unmodified. The fork adds:

- the **zbi.baby** branding, and links that keep the protocol the page was
  served with, so an instance behind TLS hands out `https://` links instead of
  downgrading them
- a **public API** on `/api`, as a Cloudflare Worker, plus a node server that
  runs the same code locally
- a small **local log** of what you shortened, in `localStorage` only

## Files worth knowing

- `docs/404.html` — the whole site, in one file
- `docs/main.js` — the browser side, plus the local log
- `docs/compress.js`, `docs/alphabets.js` — the compression core, shared by the
  browser, the Worker and the node server
- `api/core.js` — the api logic, with no node or worker specifics in it
- `api/worker.js` — Cloudflare Worker entry point
- `api/server.js` — node entry point, same behaviour, for local use
- `api/docs.html` — the api documentation page
- `test/api.test.mjs` — the api test suite, no dependencies
- `wrangler.toml` — Worker name, routes and variables

To move to a different domain, replace `zbi.baby` in `docs/main.js`,
`docs/404.html`, `docs/CNAME`, `standalone.js`, `nginx.conf` and `wrangler.toml`.

## How it works

From upstream, unchanged:

1. Common parts of the link (e.g. protocol, `www.` prefix, `index.html`) are manually detected and reduced to individual bits. If present, the port is encoded as a raw numeric value.
2. Second-level and top-level domains are matched against a Huffman-coded dictionary of the most common websites and TLDs.
3. The rest of the link is split into parts, and each segment is either fitted to a predefined character set, or Huffman coded.
4. For links, the output is encoded in the full character set of a URL. (I've been informed that square brackets `[]` are not supposed to be a part of this set, but it's too late to change that now.)
5. For QR codes, the output uses the alphanumeric character set to remove overhead compared to other QR code generators.

## Credits

ha.mr and its compression scheme are the work of [p2r3](https://github.com/p2r3/ha.mr),
MIT licensed — see [LICENSE](LICENSE). Also standing on:

- https://www.npmjs.com/package/lean-qr
- https://github.com/smythp/reddit_links_dataset
- https://github.com/ada-url/url-dataset
