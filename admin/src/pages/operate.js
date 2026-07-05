import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useToast } from '../composables/useToast.js'
import { api } from '../lib/api.js'

export const meta = { layout: 'menu', title: 'Settings' }

function groupSettings(/** @type {Record<string, any>} */ flat) {
  /** @type {Record<string, Array<{ key: string, value: any }>>} */ const groups = {}
  for (const [k, v] of Object.entries(flat ?? {})) {
    const g = k.includes('.') ? k.slice(0, k.indexOf('.')) : 'general'
    ;(groups[g] ??= []).push({ key: k, value: v })
  }
  return groups
}
const render = (/** @type {any} */ v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

function SettingsPage() {
  useMeta({ title: 'Settings · Cogworks' })
  const toast = useToast()

  const s = reactive(/** @type {{ settings: any, storage: any, busy: boolean }} */ ({ settings: null, storage: null, busy: false }))
  let setKey = ''
  let setVal = ''
  const load = () => api.get('/api/v1/admin/settings').then((r) => { s.settings = /** @type {any} */ (r)?.data ?? {} }).catch(() => { s.settings = {} })
  load()
  api.get('/api/v1/admin/settings/storage/status').then((r) => { s.storage = /** @type {any} */ (r)?.data ?? {} }).catch(() => { s.storage = {} })

  async function applySetting() {
    if (s.busy) return
    if (!setKey.trim()) { toast.error('Key is required'); return }
    s.busy = true
    try {
      const r = /** @type {any} */ (await api.patch('/api/v1/admin/settings', { [setKey.trim()]: setVal }))
      if (r?.error) throw new Error(r.error)
      toast.success('Setting saved'); await load()
    } catch (/** @type {any} */ e) { toast.error(e?.message || 'Save failed') } finally { s.busy = false }
  }

  const stat = (/** @type {string} */ label, /** @type {()=>any} */ val, /** @type {string} */ tone = '') => html`
    <div class="card p-4"><div class="field-label">${label}</div><div class="mt-1 font-display text-xl font-semibold" style="${`color:${tone ?? 'var(--color-fg)'}`}">${val}</div></div>`

  return html`
    <div class="space-y-5">
      <div>
        <h1 class="font-display text-2xl font-semibold text-fg">Settings</h1>
        <p class="mt-0.5 text-sm text-fg-soft">Configuration and the levers that keep the server running.</p>
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        ${stat('Latest release', () => (s.settings?.['update_check.latest_version'] || 'v0.1.0'), 'var(--color-brand)')}
        ${stat('Storage', () => (s.storage === null ? '…' : (s.storage.driver ?? 'local')))}
        ${stat('Settings keys', () => (s.settings === null ? '…' : Object.keys(s.settings).length))}
      </div>

      <div class="card card-pad">
        <div class="mb-3 card-title">Set a value</div>
        <div class="flex flex-wrap items-center gap-2">
          <input class="input flex-1" placeholder="setting.key" @input="${(/** @type {any} */ e) => { setKey = e.target.value }}" />
          <input class="input flex-1" placeholder="value" @input="${(/** @type {any} */ e) => { setVal = e.target.value }}" />
          <button class="btn btn-primary" aria-disabled="${() => (s.busy ? 'true' : 'false')}" @click="${applySetting}">${() => (s.busy ? 'Saving…' : 'Set')}</button>
        </div>
        <p class="mt-2 text-xs text-fg-faint">Owner escape hatch — writes any key via <span class="mono">PATCH /admin/settings</span>. Curated per-concern panels are the next build.</p>
      </div>

      ${() => {
        if (s.settings === null) return html`<div class="card p-8 text-center text-sm text-fg-faint">Loading settings…</div>`
        const groups = groupSettings(s.settings)
        const names = Object.keys(groups).sort()
        if (!names.length) return html`<div class="card p-8 text-center text-sm text-fg-faint">No settings configured — defaults in effect.</div>`
        return html`<div class="space-y-4">${names.map((g) => html`
          <div class="card overflow-hidden">
            <div class="card-head"><span class="card-title">${g}</span></div>
            <div>${groups[g].map((row) => html`
              <div class="grid trow" style="grid-template-columns:1.4fr 1fr">
                <div class="tcell tcell-mono text-fg-soft">${row.key}</div>
                <div class="tcell tcell-mono truncate text-fg">${render(row.value)}</div>
              </div>`.key(row.key))}</div>
          </div>`.key(g))}</div>`
      }}
    </div>
  `
}

export default SettingsPage
