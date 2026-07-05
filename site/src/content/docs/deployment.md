---
title: Deployment
description: Installing Cogworks, the systemd unit, reverse-proxy setup, and building the binary.
sidebar:
  order: 13
---

## Install

The installer downloads the signed binary for your platform, verifies its checksum (and optional cosign
signature), creates a service user and data directory, and installs a hardened systemd unit.

```bash title="Linux (x86_64 / aarch64)"
curl -fsSL https://get.cogworks.dev | sh

# Options
curl -fsSL https://get.cogworks.dev | sh -s -- --version v0.11.4
curl -fsSL https://get.cogworks.dev | sh -s -- --port 9000 --no-start
curl -fsSL https://get.cogworks.dev | sh -s -- --verify-sig   # cosign keyless
```

Re-running the installer performs an in-place upgrade and preserves your data, secret, and admins. It's Linux
only; on other platforms grab a prebuilt binary from the GitHub releases or build your own.

## systemd

The installed unit runs as the `cogworks` user, reads
`/etc/cogworks/cogworks.env`, and applies heavy sandboxing
(`ProtectSystem=strict`, `NoNewPrivileges`, empty capability set,
`ReadWritePaths=/var/lib/cogworks`).

```bash title="Manage the service"
systemctl status cogworks
systemctl restart cogworks
journalctl -u cogworks -f

# edit config, then restart
sudoedit /etc/cogworks/cogworks.env
```

## Reverse proxy

Cogworks serves plain HTTP on one port and does not compress or terminate TLS — put nginx or Caddy in front.
The realtime endpoints need special handling: WebSocket upgrade on `/realtime` and un-buffered SSE
on `/api/realtime`.

```text title="Caddyfile"
api.example.com {
  encode gzip zstd
  @ws  path /realtime
  @sse path /api/realtime
  reverse_proxy @sse localhost:8091 { flush_interval -1 }
  reverse_proxy @ws  localhost:8091
  reverse_proxy      localhost:8091
}
```

nginx equivalents: `proxy_read_timeout 86400s` on the WebSocket location and
`proxy_buffering off` on the SSE location. Sample nginx and Caddy configs ship in
`deploy/`.

## Serving a static site {#deploy-static}

Point `COGWORKS_PUBLIC_DIR` at a folder and Cogworks serves it as a static site —
handy for a marketing page, docs, or a compiled SPA sharing the same origin as
your API (no CORS, one deploy). It's **opt-in**: with no `COGWORKS_PUBLIC_DIR`,
nothing is served and `/` stays a 404.

```bash
COGWORKS_PUBLIC_DIR=/var/www/site cogworks
```

Static files are the **lowest-priority** handler — a request only falls through
to a file after it fails to match every API, admin (`/_/`), auth, realtime, and
[custom route](/cogworks/docs/extensibility/), and those reserved prefixes keep
their JSON 404s. Resolution for `/foo`:

1. exact file — `public/foo`
2. extensionless → `.html` — `public/foo.html`
3. directory index — `public/foo/index.html`

`/` and trailing-slash paths serve the directory `index.html`. Paths are
resolved inside the root — traversal (`../`) is rejected. HTML is sent
`Cache-Control: no-cache`; other assets get a short `max-age`.

For a client-routed **SPA**, set `COGWORKS_PUBLIC_SPA=1` so any unmatched
extensionless path serves the root `index.html` (letting the router take over);
asset requests (with an extension) still 404 when missing.

:::note[When you just need one page]
For a single dynamic HTML response — an OG-image endpoint, an embed, a webhook
landing page — a [custom route](/cogworks/docs/extensibility/) that sets
`ctx.set.headers['content-type'] = 'text/html'` and returns a string is simpler
than a whole static dir.
:::

## Building the binary

Build a self-contained executable (bundles the admin UI):

```bash title="Build"
bun run build                # → ./cogworks
bun run build:all            # all cross-compile targets → releases/
```

Targets: `linux-x64`, `linux-arm64`, `linux-x64-musl` (Alpine),
`darwin-x64`, `darwin-arm64`, `windows-x64`. A
`docker-compose.web.yml` for the landing/docs site lives at the repo root.
