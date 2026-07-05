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

      <div class="overflow-hidden rounded-panel border border-line bg-surface-raised shadow-panel">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-line font-mono text-[11px] uppercase tracking-wider text-fg-faint">
              <th class="px-4 py-3 font-medium">Name</th>
              <th class="px-4 py-3 font-medium">Kind</th>
              <th class="px-4 py-3 font-medium">Fields</th>
              <th class="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            ${() =>
              s.list === null
                ? html`<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-fg-faint">Loading…</td></tr>`
                : s.list.length === 0
                  ? html`<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-fg-faint">No collections yet.</td></tr>`
                  : s.list.map((c) =>
                      html`
                        <tr class="border-b border-line/60 transition-colors hover:bg-surface-inset">
                          <td class="px-4 py-3">
                            ${Link({ to: `/collections/${c.id}`, children: c.name, class: 'font-medium text-fg hover:text-brand' })}
                          </td>
                          <td class="px-4 py-3">
                            <span class="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[11px]" style="color:${(KIND[c.type] ?? KIND.base).color}">
                              <span class="h-1.5 w-1.5 rounded-full" style="background:${(KIND[c.type] ?? KIND.base).color}"></span>
                              ${(KIND[c.type] ?? KIND.base).label}
                            </span>
                          </td>
                          <td class="px-4 py-3 font-mono text-xs text-fg-soft">${parseFields(c.fields).length}</td>
                          <td class="px-4 py-3 font-mono text-xs text-fg-faint">${new Date((c.updated_at ?? 0) * 1000).toISOString().slice(0, 10)}</td>
                        </tr>
                      `.key(c.id),
                    )}
          </tbody>
        </table>
      </div>
    </div>
  `
}

export default CollectionsPage
