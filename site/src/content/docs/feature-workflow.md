---
title: Feature workflow
description: Build a feature end to end in Cogworks — collection → rules → server logic → realtime → typed client → agents.
sidebar:
  order: 4
---

This is the repeatable path for adding *any* feature to a Cogworks backend. We'll
build a small **`tasks`** feature the whole way through: a collection, access
rules, a server-side hook, realtime updates, a typed client call, and agent
access over MCP. Each step builds on the last.

## 1. Define a collection

A collection is a real SQLite table with typed, validated fields. Create it in
the admin UI (**Collections → New**) or apply it from a schema snapshot. Give
`tasks` an owner relation, a title, a done flag, and a due date:

```json title="tasks — fields"
[
  { "name": "owner",  "type": "relation", "options": { "collection": "users", "maxSelect": 1 }, "required": true },
  { "name": "title",  "type": "text",     "options": { "min": 1, "max": 200 }, "required": true },
  { "name": "done",   "type": "bool" },
  { "name": "due_at", "type": "date" }
]
```

The moment it exists, `tasks` has a typed REST endpoint (`/api/v1/tasks`) with
filtering, sorting, pagination, and relation expansion — nothing to generate.

## 2. Set access rules

Rules are boolean expressions evaluated per request. They decide who can list,
view, create, update, and delete. Scope tasks to their owner:

```text title="tasks — access rules"
list   @request.auth.id != "" && owner = @request.auth.id
view   owner = @request.auth.id
create @request.auth.id != ""
update owner = @request.auth.id
delete owner = @request.auth.id
```

`@request.auth.id` is the authenticated user; `owner` is the record's field. A
signed-out request has an empty `@request.auth.id`, so it's denied. Rules apply
to REST *and* realtime — a subscriber never receives a record they couldn't read.

## 3. Add server logic (a hook)

Need behaviour the rules can't express? Add a hook — server-side JavaScript that
runs around a CRUD event, authored in the admin UI (**Hooks**). Stamp the owner
and reject past due dates on create:

```js title="hook — tasks · beforeCreate"
// ctx: { record, auth, helpers }
if (!ctx.record.owner) ctx.record.owner = ctx.auth.id;      // default owner
if (ctx.record.due_at && ctx.record.due_at < Date.now() / 1000) {
  throw new ctx.helpers.ValidationError({ due_at: "due date is in the past" });
}
```

Save it and the next request runs the new code — no redeploy. There are six hook
points (before/after × create/update/delete). Heavier work? Hand it to a
[queue worker or a durable workflow](/cogworks/docs/extensibility/) with
`ctx.helpers.enqueue(...)`.

## 4. Go realtime

Subscribe over WebSocket and your UI updates as tasks change — filtered by the
same rules from step 2. Authenticate the connection, then subscribe to the
collection topic:

```js title="client — subscribe to tasks"
const ws = new WebSocket("wss://your-host/realtime");
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "auth", token: userJwt }));
  ws.send(JSON.stringify({ type: "subscribe", topics: ["tasks"] }));
};
ws.onmessage = (e) => {
  const ev = JSON.parse(e.data); // { type: "create" | "update" | "delete", record }
  applyToUi(ev);
};
```

Want "who's viewing this board"? Add [presence](/cogworks/docs/realtime/) with a
`presence-track` message on a channel.

## 5. Call it from the typed client

Cogworks generates a typed TypeScript client from your live collections at
`GET /api/v1/sdk/types.ts` — so `tasks` is fully typed end to end:

```ts title="client — typed SDK"
import { Cogworks } from "./cogworks-sdk"; // generated from /api/v1/sdk/types.ts

const cw = new Cogworks("https://your-host", { token: userJwt });

const task = await cw.collection("tasks").create({
  title: "Ship the docs",
  due_at: Math.floor(Date.now() / 1000) + 86_400,
});

const open = await cw.collection("tasks").list({
  filter: "done = false",
  sort: "due_at",
  expand: "owner",
});
```

## 6. (Optional) Expose it to agents

Because `tasks` is a normal collection, it's automatically available over the
[MCP server](/cogworks/docs/platform/) as scope-gated tools
(`cogworks.list_tasks`, `cogworks.create_tasks`, …). Mint a token with the scopes
an agent should have, point Claude/Cursor at `cogworks mcp`, and it can read and
write tasks under the same rules — every call audited.

---

That's the whole loop: **collection → rules → hook → realtime → typed client →
agents**. Every feature you add follows the same five (or six) steps. For fully
worked apps, see [Examples](/cogworks/docs/examples/).
