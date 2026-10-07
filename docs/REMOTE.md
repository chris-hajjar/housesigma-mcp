# Remote housesigma-mcp: hosted files, hosted photos, AWS deploy

Status: idea, not started. Written 2026-09-23 after v0.1.0 shipped locally. Nothing here is built.

## Goal

Run housesigma-mcp on a server instead of the Mac, connect to it from Claude Code, Claude Desktop and
claude.ai, and stop depending on a local `data/` folder:

- CSVs (search exports, pulls) come back as downloadable links, not paths.
- Photos can be hosted under our own links, with one gallery page per listing.
- Session, cache, tracked searches, snapshots and pull state live on the server.

Decision so far: **AWS** (S3 + EC2). Fly.io + Cloudflare R2 was the alternative; same code, different adapters.

## What changes in the code

### 1. Storage layer (half a day)

Today `src/csv.js` `writeCsv()` returns a local path, `src/pull.js` appends to a local file, and `get_photos`
writes to `data/photos/<id>/`. Replace "path" with one small interface:

```
storage.put(bytes | stream, name, contentType) -> { url, expires_at }
storage.append(name, text)                      // pulls stream rows as they go
storage.list(prefix) / storage.get(name)
```

Two adapters, chosen by env:

- `local` (default, no config): files under `data/exports`, `data/photos`. In HTTP mode the URL is a **signed
  link** served by `bin/http.js`: `GET /files/<name>?exp=<unix>&sig=<hmac>`. HMAC key derived from `MCP_BEARER`.
  Default expiry 24 h. Lets a self-hosted box hand out browser-openable links with no bearer header.
- `s3`: private bucket, prefixes `exports/`, `photos/`, `galleries/`. Upload with `@aws-sdk/client-s3`, return
  presigned GET links from `@aws-sdk/s3-request-presigner`. Presigned links from a long-lived IAM user key can last
  up to 7 days; links signed with an instance-role session are capped by the session (6 to 12 h), so give the
  server a dedicated IAM user scoped to the one bucket.

Tool shapes do not change: `csv: true` still returns `csv:`, it just holds a link. Pull status returns a link.
`get_photos` gains `host: true`: copy the listing's photos into storage and return our own links plus one gallery.

Env:
```
HS_STORAGE=local|s3
HS_S3_BUCKET=...            HS_S3_REGION=ca-central-1
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   (IAM user, bucket-only policy)
HS_LINK_TTL_HOURS=24
```

### 2. Photo gallery page (two hours)

One static HTML per listing at `galleries/<id_listing>.html`: address, price, beds/baths/sqft, listing history
table, photo grid, link back to HouseSigma. Built from `get_listing` + `get_photos`. One link to open on a phone.

### 3. Server (half a day)

- EC2 `t4g.nano` or `t4g.micro`, Ubuntu, Node 22. Lightsail is the same box with a fixed price if preferred.
- `bin/http.js` behind **Caddy** for automatic HTTPS on a subdomain. systemd unit keeps it up; pulls need a
  process that stays alive ~30 min, so no Lambda (15 min cap).
- `data/` on the instance's EBS disk (session.json, filters, tracked searches, snapshots, pulls.json).
- Secrets in `/etc/housesigma-mcp.env`: `MCP_BEARER`, `HS_ACCESS_TOKEN` (or copy `data/session.json` up),
  S3 vars above.
- Login on a server: run `login` locally once and copy the token, or call `login {access_token}` remotely with a
  token pasted from DevTools. The 7-day secret refresh already runs server-side.
- Security group: 443 only. Consider restricting to home IP if not using OAuth.

Cost: roughly $3 to $8 a month for the instance (free-tier eligible the first year), S3 pennies.

### 4. Auth for the harnesses (half a day)

- Claude Code: works today with `claude mcp add --transport http housesigma https://host/mcp --header "Authorization: Bearer <MCP_BEARER>"`.
- Claude Desktop custom connectors and claude.ai want **OAuth 2.0**. Add a minimal single-user provider using the
  MCP SDK's auth router (`mcpAuthRouter` + a tiny provider: one password, issue/refresh tokens, dynamic client
  registration on). Until then, remote works from Claude Code only.

### 5. Retire the local folder

Once files are in S3 and state is on the server, `~/Desktop/housesigma-mcp/data` goes away. The local stdio
mode keeps working unchanged for offline use.

## Build order

1. Storage layer + signed local links + S3 adapter. Testable on the Mac with just a bucket and keys.
2. Gallery page.
3. EC2 deploy (systemd, Caddy, env file).
4. OAuth shim.

Total ~1.5 to 2 days.

## Needed from Chris

- AWS account: bucket name, region, IAM user key pair with a bucket-only policy.
- A subdomain for the server.
- Instance size preference (nano is enough).

## Cautions

- Presigned / signed links are bearer links: anyone holding one can download listing data until expiry. Keep
  expiries short, never post them.
- Hosting changes nothing about volume. Whole-city pulls are ~1,500 requests on a personal account; keep them
  occasional. See README "Guardrails".
- HouseSigma photo URLs (`cache*.housesigma.com`) are fetched with a Referer header today; hosting copies them
  into our bucket, so galleries do not depend on their cache lifetime.
