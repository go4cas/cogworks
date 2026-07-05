import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { api, parseFields } from '../lib/api.js'
import { Link } from '../components/Link.js'

export const meta = { layout: 'menu', title: 'Data' }

/** @type {Record<string, { label: string, color: string }>} */
const KIND = {
  base: { label: 'base', color: 'var(--color-brand)' },
  auth: { label: 'auth', color: 'var(--color-ok)' },
  view: { label: 'view', color: 'var(--color-warn)' },
}

function CollectionsPage() {
  useMeta({ title: 'Data · Cogworks' })

  const s = reactive(/** @type {{ list: any[] | null }} */ ({ list: null }))
  api.get('/api/v1/collections').then((r) => { s.list = /** @type {any} */ (r)?.data ?? [] }).catch(() => { s.list = [] })

  return html`
    <div class="space-y-6">
      <div class="flex items-end justify-between">
        <div>
          <div class="font-mono text-[11px] uppercase tracking-[0.2em] text-brand">data</div>
          <h1 class="mt-1 font-display text-2xl font-semibold text-fg">Collections</h1>
          <p class="mt-1 text-sm text-fg-soft">Each collection is a real SQLite table — schema, rules, and records.</p>
        </div>
        <button class="rounded-control bg-brand px-3.5 py-2 text-sm font-semibold text-[#12233f] shadow-panel hover:bg-brand-hover">New collection</button>
      </div>

      <div class="overflow-hidden rounded-panel border border-line bg-surface-raised text-sm shadow-panel">
        <div class="grid grid-cols-[1.6fr_0.8fr_0.6fr_1fr] border-b border-line font-mono text-[11px] uppercase tracking-wider text-fg-faint">
          <div class="px-4 py-3 font-medium">Name</div>
          <div class="px-4 py-3 font-medium">Kind</div>
          <div class="px-4 py-3 font-medium">Fields</div>
          <div class="px-4 py-3 font-medium">Updated</div>
        </div>
        ${() => {
          if (s.list === null) return html`<div class="px-4 py-6 text-center text-sm text-fg-faint">Loading…</div>`
          if (s.list.length === 0) return html`<div class="px-4 py-6 text-center text-sm text-fg-faint">No collections yet.</div>`
          return html`<div>
            ${s.list.map((c) => {
              const k = KIND[c.type] ?? KIND.base
              return html`
                <div class="grid grid-cols-[1.6fr_0.8fr_0.6fr_1fr] items-center border-b border-line/60 transition-colors hover:bg-surface-inset">
                  <div class="px-4 py-3">${Link({ to: `/collections/${c.id}`, children: c.name, class: 'font-medium text-fg hover:text-brand' })}</div>
                  <div class="px-4 py-3">
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[11px]" style="${`color:${k.color}`}">
                      <span class="h-1.5 w-1.5 rounded-full" style="${`background:${k.color}`}"></span>${k.label}
                    </span>
                  </div>
                  <div class="px-4 py-3 font-mono text-xs text-fg-soft">${parseFields(c.fields).length}</div>
                  <div class="px-4 py-3 font-mono text-xs text-fg-faint">${new Date((c.updated_at ?? 0) * 1000).toISOString().slice(0, 10)}</div>
                </div>
              `.key(c.id)
            })}
          </div>`
        }}
      </div>
    </div>
  `
}

export default CollectionsPage
