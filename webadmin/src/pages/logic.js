import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { api } from '../lib/api.js'
import { CodeEditor } from '../components/CodeEditor.js'

export const meta = { layout: 'menu', title: 'Logic' }

const led = (/** @type {boolean} */ on) =>
  html`<span class="h-1.5 w-1.5 rounded-full" style="${`background:${on ? 'var(--color-ok)' : 'var(--color-fg-faint)'}`}"></span>`

/** @type {Record<string, string>} */
const STATUS_COLOR = { ok: 'var(--color-ok)', success: 'var(--color-ok)', error: 'var(--color-bad)', failed: 'var(--color-bad)' }

function LogicPage() {
  useMeta({ title: 'Logic · Cogworks' })

  const s = reactive(
    /** @type {{ hooks: any[]|null, routes: any[]|null, jobs: any[]|null, sel: any }} */
    ({ hooks: null, routes: null, jobs: null, sel: null }),
  )

  api.get('/api/v1/admin/hooks').then((r) => { s.hooks = /** @type {any} */ (r)?.data ?? [] }).catch(() => { s.hooks = [] })
  api.get('/api/v1/admin/routes').then((r) => { s.routes = /** @type {any} */ (r)?.data ?? [] }).catch(() => { s.routes = [] })
  api.get('/api/v1/admin/jobs').then((r) => { s.jobs = /** @type {any} */ (r)?.data ?? [] }).catch(() => { s.jobs = [] })

  /** @param {string} kind @param {any} item */
  const select = (kind, item) => { s.sel = { kind, item } }

  const sectionHead = (/** @type {string} */ title, /** @type {any[]|null} */ list) => html`
    <div class="flex items-center justify-between border-b border-line px-4 py-3">
      <div class="font-mono text-[11px] uppercase tracking-wider text-fg-faint">${title}</div>
      <span class="font-mono text-[11px] text-fg-faint">${() => (list === null ? '' : `${list.length}`)}</span>
    </div>`

  /** A clickable row that opens the item's code in the viewer. */
  const row = (/** @type {string} */ kind, /** @type {any} */ item, /** @type {any} */ children) => html`
    <button
      @click="${() => select(kind, item)}"
      class="${() => `block w-full border-b border-line/60 px-4 py-2.5 text-left transition-colors hover:bg-surface-inset ${s.sel?.item?.id === item.id ? 'bg-surface-inset' : ''}`}"
    >${children}</button>`

  return html`
    <div class="space-y-6">
      <div>
        <div class="font-mono text-[11px] uppercase tracking-[0.2em] text-brand">logic</div>
        <h1 class="mt-1 font-display text-2xl font-semibold text-fg">Logic</h1>
        <p class="mt-1 text-sm text-fg-soft">Code that runs on events, requests, and schedules — click any item to read its source.</p>
      </div>

      <div class="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div class="space-y-6">
          <section class="overflow-hidden rounded-panel border border-line bg-surface-raised text-sm shadow-panel">
            ${sectionHead('Hooks', null)}
            ${() => {
              if (s.hooks === null) return html`<div class="px-4 py-5 text-center text-fg-faint">Loading…</div>`
              if (!s.hooks.length) return html`<div class="px-4 py-5 text-center text-fg-faint">No hooks yet.</div>`
              return html`<div>${s.hooks.map((h) => row('hook', h, html`
                <span class="flex items-center gap-2.5">
                  ${() => led(!!h.enabled)}
                  <span class="font-mono text-xs text-brand">${h.event}</span>
                  <span class="text-fg">${h.collection_name || h.name || '—'}</span>
                </span>`).key(h.id))}</div>`
            }}
          </section>

          <section class="overflow-hidden rounded-panel border border-line bg-surface-raised text-sm shadow-panel">
            ${sectionHead('Routes', null)}
            ${() => {
              if (s.routes === null) return html`<div class="px-4 py-5 text-center text-fg-faint">Loading…</div>`
              if (!s.routes.length) return html`<div class="px-4 py-5 text-center text-fg-faint">No custom routes yet.</div>`
              return html`<div>${s.routes.map((r) => row('route', r, html`
                <span class="flex items-center gap-2.5">
                  ${() => led(!!r.enabled)}
                  <span class="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-fg-soft">${r.method}</span>
                  <span class="font-mono text-xs text-fg">${r.path}</span>
                </span>`).key(r.id))}</div>`
            }}
          </section>

          <section class="overflow-hidden rounded-panel border border-line bg-surface-raised text-sm shadow-panel">
            ${sectionHead('Jobs', null)}
            ${() => {
              if (s.jobs === null) return html`<div class="px-4 py-5 text-center text-fg-faint">Loading…</div>`
              if (!s.jobs.length) return html`<div class="px-4 py-5 text-center text-fg-faint">No jobs yet.</div>`
              return html`<div>${s.jobs.map((j) => row('job', j, html`
                <span class="flex items-center gap-2.5">
                  ${() => led(!!j.enabled)}
                  <span class="text-fg">${j.name || '(unnamed)'}</span>
                  <span class="font-mono text-[11px] text-fg-faint">${j.cron || 'one-off'}</span>
                  ${j.last_status ? html`<span class="ml-auto font-mono text-[10px]" style="${`color:${STATUS_COLOR[j.last_status] ?? 'var(--color-fg-faint)'}`}">${j.last_status}</span>` : ''}
                </span>`).key(j.id))}</div>`
            }}
          </section>
        </div>

        <div class="xl:sticky xl:top-20 xl:self-start">
          ${() =>
            s.sel
              ? html`
                <div class="space-y-2">
                  <div class="flex items-center gap-2 font-mono text-[11px] text-fg-faint">
                    <span class="uppercase tracking-wider text-brand">${s.sel.kind}</span>
                    <span>·</span>
                    <span class="text-fg-soft">${s.sel.item.event || s.sel.item.path || s.sel.item.name || s.sel.item.id}</span>
                  </div>
                  ${CodeEditor({ value: s.sel.item.code || '// (no code)', language: 'javascript', height: 460 })}
                </div>`
              : html`<div class="flex h-full min-h-[200px] items-center justify-center rounded-panel border border-dashed border-line-strong bg-surface-raised p-8 text-center font-mono text-xs text-fg-faint">Select a hook, route, or job to read its source.</div>`}
        </div>
      </div>
    </div>
  `
}

export default LogicPage
