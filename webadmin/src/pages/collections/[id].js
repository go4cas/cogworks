import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../../framework/index.js'
import { useRoute } from '../../composables/useRoute.js'
import { api, parseFields } from '../../lib/api.js'
import { Link } from '../../components/Link.js'

export const meta = { layout: 'menu', title: 'Collection' }

/** @type {Record<string, { label: string, color: string }>} */
const KIND = {
  base: { label: 'base', color: 'var(--color-brand)' },
  auth: { label: 'auth', color: 'var(--color-ok)' },
  view: { label: 'view', color: 'var(--color-warn)' },
}

const RULES = /** @type {const} */ ([
  ['list_rule', 'List'],
  ['view_rule', 'View'],
  ['create_rule', 'Create'],
  ['update_rule', 'Update'],
  ['delete_rule', 'Delete'],
])

function CollectionDetail() {
  const route = useRoute()
  const id = route.params().id
  useMeta({ title: () => `${s.col?.name ?? 'Collection'} · Cogworks` })

  const s = reactive(/** @type {{ col: any, error: string }} */ ({ col: null, error: '' }))
  api.get(`/api/v1/collections/${id}`)
    .then((r) => { const d = /** @type {any} */ (r); if (d?.error) s.error = d.error; else s.col = d?.data ?? null })
    .catch((/** @type {any} */ e) => { s.error = e?.message || 'Failed to load' })

  const kind = () => KIND[s.col?.type] ?? KIND.base

  return html`
    <div class="space-y-6">
      <div>
        ${Link({ to: '/collections', children: '‹ Collections', class: 'font-mono text-[11px] text-fg-faint hover:text-fg-soft' })}
        ${() =>
          s.error
            ? html`<h1 class="mt-2 font-display text-2xl font-semibold" style="color:var(--color-bad)">${s.error}</h1>`
            : html`
              <div class="mt-2 flex items-center gap-3">
                <h1 class="font-display text-2xl font-semibold text-fg">${() => s.col?.name ?? '…'}</h1>
                ${() =>
                  s.col
                    ? html`<span class="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[11px]" style="${`color:${kind().color}`}">
                        <span class="h-1.5 w-1.5 rounded-full" style="${`background:${kind().color}`}"></span>${kind().label}
                      </span>`
                    : ''}
              </div>
              <p class="mt-1 font-mono text-[11px] text-fg-faint">${() => (s.col ? `cw_${s.col.name} · ${parseFields(s.col.fields).length} fields` : '')}</p>
            `}
      </div>

      ${() =>
        s.col
          ? html`
            <div class="overflow-hidden rounded-panel border border-line bg-surface-raised shadow-panel">
              <div class="border-b border-line px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-fg-faint">Schema</div>
              <table class="w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-line font-mono text-[11px] uppercase tracking-wider text-fg-faint">
                    <th class="px-4 py-2.5 font-medium">Field</th>
                    <th class="px-4 py-2.5 font-medium">Type</th>
                    <th class="px-4 py-2.5 font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  ${parseFields(s.col.fields).map((/** @type {any} */ f) =>
                    html`
                      <tr class="border-b border-line/60">
                        <td class="px-4 py-2.5 font-medium text-fg">${f.name}</td>
                        <td class="px-4 py-2.5 font-mono text-xs text-brand">${f.type}</td>
                        <td class="px-4 py-2.5">
                          <span class="flex flex-wrap gap-1.5 font-mono text-[10px] text-fg-faint">
                            ${f.required ? html`<span class="rounded border border-line px-1.5 py-0.5">required</span>` : ''}
                            ${f.system ? html`<span class="rounded border border-line px-1.5 py-0.5">system</span>` : ''}
                            ${f.collection ? html`<span class="rounded border border-line px-1.5 py-0.5">→ ${f.collection}</span>` : ''}
                          </span>
                        </td>
                      </tr>
                    `.key(f.name),
                  )}
                </tbody>
              </table>
            </div>

            <div class="rounded-panel border border-line bg-surface-raised p-5 shadow-panel">
              <div class="font-mono text-[11px] uppercase tracking-wider text-fg-faint">Access rules</div>
              <div class="mt-3 grid gap-2">
                ${RULES.map(([key, label]) => {
                  const val = s.col[key]
                  return html`
                    <div class="flex items-start gap-3 rounded-control border border-line bg-surface-inset px-3 py-2">
                      <span class="w-16 shrink-0 font-mono text-xs text-fg-soft">${label}</span>
                      <span class="font-mono text-xs ${val ? 'text-fg' : 'text-fg-faint'}">${val || 'public — no rule'}</span>
                    </div>
                  `
                })}
              </div>
            </div>
          `
          : ''}
    </div>
  `
}

export default CollectionDetail
