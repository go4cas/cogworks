---
title: Why Cogworks?
description: Where Cogworks fits — a self-hosted, single-binary backend — and honestly, when to choose something else.
sidebar:
  order: 0
---

Cogworks is a **self-hosted backend-as-a-service that ships as one binary**. Drop
it on any box, run it, and you get a database, a typed REST API, realtime, auth,
file storage, background jobs, search, and a first-party MCP server for AI agents
— assembled and wired together, with no black boxes and nothing to orchestrate.

It's built on Bun + Hono + SQLite, and it's a fork of
[Vaultbase](https://github.com/vaultbase-sh/vaultbase) whose main divergence is
the HTTP layer (Elysia → Hono).

## Choose Cogworks when…

- **You want to own your data and your stack.** One process, one SQLite file. No
  managed control plane, no per-seat pricing, no vendor to page.
- **You want to ship, not assemble.** Collections, REST, auth, realtime, queues,
  and search are already integrated — you don't glue a database to an auth
  service to a job runner.
- **Operational simplicity matters.** A single binary is trivial to deploy,
  reproduce, back up (it's a file), and reason about. Great for solo devs,
  small teams, edge boxes, on-prem, and air-gapped installs.
- **You want AI agents to reach your data safely.** The built-in MCP server
  exposes scope-gated, rate-limited tools that any agent (Claude, Cursor, …) can
  call — without you building an integration.

## How it compares

| | **Cogworks** | PocketBase | Supabase | Firebase |
|---|---|---|---|---|
| Runs as | one binary | one binary | many services (or managed) | managed only |
| Database | SQLite | SQLite | Postgres | proprietary |
| Self-host | ✓ | ✓ | ✓ (heavy) | ✗ |
| Realtime | WS + SSE + presence | SSE | ✓ | ✓ |
| Auth | password · OAuth2 · MFA · passkeys | ✓ | ✓ | ✓ |
| Server logic | JS hooks / routes / **durable workflows** | Go / JS hooks | edge functions | cloud functions |
| Queues & cron | built in | — | external | external |
| AI / MCP | **first-party MCP server** | — | — | — |
| Vendor lock-in | none (MIT, your file) | none | low–medium | high |

The closest peer is **PocketBase** — same single-binary, SQLite-first spirit.
Cogworks leans further into the "batteries included" end: durable queues and
workflows, vector search, an MCP server, encrypted fields, operator roles, and
observability are in the box.

## Choose something else when…

- **You don't want to run a server at all.** If a fully-managed backend is the
  goal, reach for Supabase or Firebase.
- **You need Postgres specifically**, horizontal write-scaling, or multi-region
  active-active. Cogworks is SQLite-first by design — brilliant for a single
  node, not a sharded cluster. (Read replicas / PITR are on the roadmap, not a
  distributed write layer.)
- **You're all-in on a cloud ecosystem** (e.g. Firebase + the rest of Google).
- **You need a large, battle-tested community today.** Cogworks is young; if
  that's a hard requirement, a more established project may fit better.

Honest about the trade-offs: the single-binary, SQLite-only model is the whole
point — it's what makes Cogworks simple. If those constraints don't fit your
problem, that's a signal, not a bug.

## Next

- [Introduction](/cogworks/docs/introduction/) — what's in the box, in one page.
- [Getting started](/cogworks/docs/getting-started/) — install and first run.
- [Feature workflow](/cogworks/docs/feature-workflow/) — build a feature end to end.
