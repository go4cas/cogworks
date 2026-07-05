---
title: AI & agents
description: How Cogworks fits into AI apps — a first-party MCP server for agents and vector search for RAG. Honest about what it does and doesn't do.
sidebar:
  order: 5
---

Cogworks gives you two AI building blocks, and is deliberately clear about the
boundary:

- **MCP server** — let AI agents read and write your data (and run admin tasks) safely.
- **Vector search** — store embeddings and query by similarity for semantic search / RAG.

:::note[Cogworks is AI-ready infrastructure, not an AI service]
There is **no built-in LLM inference and no embedding generation**. Cogworks
*stores and searches* vectors and *exposes* your data to agents — you bring the
model (OpenAI, Anthropic, a local embedder, …). This keeps the single binary
lean and provider-agnostic.
:::

## Agents via MCP

Cogworks speaks the [Model Context Protocol](https://modelcontextprotocol.io) out
of the box, so any MCP client — Claude Desktop, Cursor, Continue, Cline — can
work against your backend:

- **Per-collection tools** — every collection automatically exposes
  `list_ / get_ / create_ / update_ / delete_` tools (e.g. `cogworks.list_posts`),
  plus admin/introspection tools (`describe_collection`, `run_sql`, `read_logs`,
  `read_audit_log`, flags, settings, jobs, …).
- **Scope-gated** — the token's scopes decide what an agent can touch
  (`mcp:read` / `mcp:write` / `mcp:admin`, and per-collection scopes). Start
  read-only with `--read-only` and widen deliberately.
- **Audited** — MCP activity is subject to the same audit trail and rate limits
  as the rest of the API.
- **Two transports** — **stdio** (for desktop agents) and **HTTP** (for remote /
  multi-user).

```bash title="run the MCP server (stdio)"
cogworks mcp --token cwat_… --read-only
```

```json title="Claude Desktop / Cursor config"
{
  "mcpServers": {
    "cogworks": {
      "command": "cogworks",
      "args": ["mcp", "--read-only"],
      "env": { "COGWORKS_MCP_TOKEN": "cwat_…" }
    }
  }
}
```

Full detail: [MCP (AI agents)](/cogworks/docs/platform/).

## Vector search (RAG)

Add a `vector` field to any collection, write your embeddings to it, and query by
nearest neighbour:

```bash title="query by similarity"
GET /api/v1/docs?nearVector=[0.12,0.03,…]&nearVectorField=embedding&nearLimit=5
```

- **`vector` field type** — a fixed-dimension embedding column (1–4096 dims).
- **`nearVector` query** — cosine similarity, ranked, under the same access rules
  as any other read.
- **Swappable backend** — the ranking sits behind a seam so a faster ANN index
  can drop in later without changing the query API.

Full detail: [Vector search](/cogworks/docs/rest-api/).

## Building a RAG feature

The end-to-end shape, with the model living on *your* side:

1. **Define** a collection with a `text` field and a `vector` field (matching your
   embedder's dimensions).
2. **Embed on write** — in a [hook](/cogworks/docs/extensibility/) or your app,
   call your embedding provider and store the vector alongside the text.
3. **Retrieve** — embed the user's query the same way, then `nearVector` to pull
   the top-k most similar records (rule-filtered, so users only match what they
   can see).
4. **Generate** — feed those records to your LLM as context.

Agents can drive the same collections directly over MCP — so a Claude/Cursor
session can search, read, and (with write scope) update your data under the rules
you set.
