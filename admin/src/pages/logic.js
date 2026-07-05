import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useToast } from '../composables/useToast.js'
import { api } from '../lib/api.js'
import { CodeEditor } from '../components/CodeEditor.js'
import { Icon } from '../components/Icon.js'

export const meta = { layout: 'menu', title: 'Logic' }

const HOOK_EVENTS = ['beforeCreate', 'afterCreate', 'beforeUpdate', 'afterUpdate', 'beforeDelete', 'afterDelete']
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
/** @type {Record<string, string>} */
const STATUS_COLOR = { succeeded: 'var(--color-ok)', ok: 'var(--color-ok)', failed: 'var(--color-bad)', error: 'var(--color-bad)' }
const led = (/** @type {boolean} */ on) => html`<span class="dot" style="${`background:${on ? 'var(--color-ok)' : 'var(--color-fg-faint)'}`}"></span>`

/** @type {Record<string, any>} */
const TYPES = {
  hook: { kind: 'code', label: 'Hooks', seg: 'hooks', idKey: 'id',
    title: (/** @type {any} */ i) => `${i.event} · ${i.collection_name || '—'}`,
    fresh: () => ({ collection_name: '', event: 'beforeCreate', enabled: true, code: '// ctx.record is the incoming record\n' }) },
  route: { kind: 'code', label: 'Routes', seg: 'routes', idKey: 'id',
    title: (/** @type {any} */ i) => `${i.method} ${i.path}`,
    fresh: () => ({ name: '', method: 'GET', path: '/', enabled: true, code: 'return helpers.json({ ok: true })\n' }) },
  job: { kind: 'code', label: 'Jobs', seg: 'jobs', idKey: 'id',
    title: (/** @type {any} */ i) => `${i.name || 'job'} · ${i.cron || 'one-off'}`,
    fresh: () => ({ name: '', cron: '0 3 * * *', enabled: true, code: 'helpers.log("running")\n' }) },
  webhook: { kind: 'config', label: 'Webhooks', seg: 'webhooks', idKey: 'id', test: true,
    title: (/** @type {any} */ i) => i.name || i.url,
    fresh: () => ({ name: '', url: 'https://', events: '', secret: '', enabled: true }),
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'url', label: 'Endpoint URL' },
      { key: 'events', label: 'Events (comma-separated)', help: 'e.g. posts.create, posts.update' },
      { key: 'secret', label: 'HMAC signing secret', type: 'password' },
    ] },
  flag: { kind: 'config', label: 'Flags', seg: 'flags', idKey: 'key',
    title: (/** @type {any} */ i) => i.key,
    fresh: () => ({ key: '', description: '', type: 'bool', default_value: 'false', enabled: true }),
    fields: [
      { key: 'key', label: 'Key' },
      { key: 'description', label: 'Description' },
      { key: 'type', label: 'Type', type: 'select', options: ['bool', 'string', 'number', 'json'] },
      { key: 'default_value', label: 'Default value' },
    ] },
}
const ORDER = ['hook', 'route', 'job', 'webhook', 'flag']

function LogicPage() {
  useMeta({ title: 'Logic · Cogworks' })
  const toast = useToast()

  const s = reactive(
    /** @type {{ type:string, lists:Record<string,any[]|null>, sel:any, creating:boolean, dirty:boolean, saving:boolean }} */
    ({ type: 'hook', lists: { hook: null, route: null, job: null, webhook: null, flag: null }, sel: null, creating: false, dirty: false, saving: false }),
  )
  let draft = ''
  /** @type {Record<string,any>} */ let meta = {}

  const load = (/** @type {string} */ t) => api.get(`/api/v1/admin/${TYPES[t].seg}`).then((r) => { s.lists[t] = /** @type {any} */ (r)?.data ?? [] }).catch(() => { s.lists[t] = [] })
  ORDER.forEach(load)

  const idOf = (/** @type {any} */ item) => item[TYPES[s.type].idKey]
  function select(/** @type {any} */ item) {
    s.sel = item; s.creating = false; s.dirty = false
    if (TYPES[s.type].kind === 'code') draft = item.code || ''
    else { meta = {}; for (const f of TYPES[s.type].fields) meta[f.key] = f.key === 'events' && Array.isArray(item[f.key]) ? item[f.key].join(', ') : (item[f.key] ?? '') }
  }
  function startNew() { s.creating = true; s.sel = null; s.dirty = false; meta = TYPES[s.type].fresh(); draft = meta.code || '' }

  function configBody() {
    /** @type {Record<string,any>} */ const b = {}
    for (const f of TYPES[s.type].fields) {
      let v = meta[f.key]
      if (f.key === 'events') v = String(v || '').split(',').map((x) => x.trim()).filter(Boolean)
      b[f.key] = v
    }
    b.enabled = meta.enabled !== false
    return b
  }

  async function save() {
    if (s.saving) return
    s.saving = true
    try {
      const cfg = TYPES[s.type]
      const body = cfg.kind === 'code' ? { ...(s.creating ? meta : {}), code: draft } : configBody()
      if (s.creating) {
        const r = /** @type {any} */ (await api.post(`/api/v1/admin/${cfg.seg}`, body))
        if (r?.error) throw new Error(r.error)
        toast.success('Created'); s.creating = false; s.sel = r?.data ?? null; s.dirty = false
      } else {
        const r = /** @type {any} */ (await api.patch(`/api/v1/admin/${cfg.seg}/${idOf(s.sel)}`, body))
        if (r?.error) throw new Error(r.error)
        if (cfg.kind === 'code') s.sel.code = draft
        s.dirty = false; toast.success('Saved')
      }
      await load(s.type)
    } catch (/** @type {any} */ e) { toast.error(e?.message || 'Save failed') } finally { s.saving = false }
  }
  async function toggleEnabled() {
    if (!s.sel) return
    const next = !s.sel.enabled
    try { await api.patch(`/api/v1/admin/${TYPES[s.type].seg}/${idOf(s.sel)}`, { enabled: next }); s.sel.enabled = next; await load(s.type); toast.success(next ? 'Enabled' : 'Disabled') }
    catch (/** @type {any} */ e) { toast.error(e?.message || 'Failed') }
  }
  async function runOrTest() {
    if (!s.sel) return
    try {
      if (s.type === 'job') await api.post(`/api/v1/admin/jobs/${s.sel.id}/run`, {})
      else if (s.type === 'webhook') await api.post(`/api/v1/admin/webhooks/${s.sel.id}/test`, {})
      toast.success(s.type === 'job' ? 'Job triggered' : 'Test sent'); await load(s.type)
    } catch (/** @type {any} */ e) { toast.error(e?.message || 'Failed') }
  }
  async function remove() {
    if (!s.sel || !globalThis.confirm(`Delete this ${s.type}?`)) return
    const t = s.type
    try { await api.delete(`/api/v1/admin/${TYPES[t].seg}/${idOf(s.sel)}`); s.sel = null; await load(t); toast.success('Deleted') } catch (/** @type {any} */ e) { toast.error(e?.message || 'Delete failed') }
  }

  const tabBtn = (/** @type {string} */ t) => html`
    <button @click="${() => { s.type = t; s.sel = null; s.creating = false }}" class="${() => `flex items-center gap-1.5 border-b-2 px-1 pb-2.5 pt-1 text-sm font-medium transition-colors ${s.type === t ? 'border-brand text-fg' : 'border-transparent text-fg-faint hover:text-fg-soft'}`}">
      ${TYPES[t].label}<span class="mono text-xs text-fg-faint">${() => { const l = s.lists[t]; return l ? l.length : '' }}</span>
    </button>`

  function rowItem(/** @type {any} */ item) {
    return html`
      <button @click="${() => select(item)}" class="${() => `flex w-full items-center gap-2.5 rounded-control px-3 py-2.5 text-left text-sm transition-colors ${idOf(s.sel || {}) === idOf(item) && s.sel ? 'bg-brand-tint' : 'hover:bg-surface-hover'}`}">
        ${led(!!item.enabled)}
        <span class="${() => `min-w-0 flex-1 truncate ${s.sel && idOf(s.sel) === idOf(item) ? 'text-brand' : 'text-fg'}`}">${TYPES[s.type].title(item)}</span>
        ${item.last_status ? html`<span class="mono text-[10px]" style="${`color:${STATUS_COLOR[item.last_status] ?? 'var(--color-fg-faint)'}`}">${item.last_status}</span>` : ''}
      </button>`
  }

  const metaField = (/** @type {string} */ label, /** @type {any} */ control) => html`<label class="space-y-1"><span class="field-label">${label}</span>${control}</label>`

  function configForm() {
    return html`<div class="grid gap-3 p-4 sm:grid-cols-2">
      ${TYPES[s.type].fields.map((/** @type {any} */ f) => {
        const t = f.type ?? 'text'
        const ctrl = t === 'select'
          ? html`<select class="select" @change="${(/** @type {any} */ e) => { meta[f.key] = e.target.value }}">${[meta[f.key] ?? f.options[0], ...f.options.filter((/** @type {any} */ o) => o !== (meta[f.key] ?? f.options[0]))].map((/** @type {any} */ o) => html`<option value="${o}">${o}</option>`.key(o))}</select>`
          : html`<input class="input" type="${t === 'password' ? 'password' : 'text'}" placeholder="${t === 'password' ? '•••••• (unchanged)' : ''}" value="${meta[f.key] ?? ''}" @input="${(/** @type {any} */ e) => { meta[f.key] = e.target.value }}" />`
        return html`<div>${metaField(f.label, ctrl)}${f.help ? html`<span class="mt-1 block text-xs text-fg-faint">${f.help}</span>` : ''}</div>`.key(f.key)
      })}
    </div>`
  }

  function editorPane() {
    const cfg = TYPES[s.type]
    return html`
      <div class="flex h-full flex-col">
        <div class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <span class="mono text-xs text-fg-faint">${() => (s.creating ? `new ${s.type}` : cfg.title(s.sel))}</span>
          <div class="ml-auto flex items-center gap-1.5">
            ${() => s.creating ? '' : html`<button class="btn btn-secondary btn-sm" @click="${toggleEnabled}">${() => (s.sel.enabled ? 'Disable' : 'Enable')}</button>`}
            ${() => (!s.creating && (s.type === 'job' || s.type === 'webhook')) ? html`<button class="btn btn-secondary btn-sm" @click="${runOrTest}">${Icon({ name: 'play', size: 13, fill: true })} ${s.type === 'job' ? 'Run' : 'Test'}</button>` : ''}
            ${() => s.creating ? '' : html`<button class="btn btn-danger btn-sm" @click="${remove}">${Icon({ name: 'trash', size: 13 })}</button>`}
            <button class="btn btn-primary btn-sm" aria-disabled="${() => ((cfg.kind === 'code' && !s.dirty && !s.creating) || s.saving ? 'true' : 'false')}" @click="${save}">${() => (s.saving ? 'Saving…' : s.creating ? 'Create' : 'Save')}</button>
          </div>
        </div>
        ${() => cfg.kind === 'config' ? configForm() : html`
          ${() => s.creating ? html`
            <div class="grid gap-3 border-b border-line p-4 sm:grid-cols-2">
              ${s.type === 'hook' ? html`
                ${metaField('Collection', html`<input class="input" placeholder="posts" @input="${(/** @type {any} */ e) => { meta.collection_name = e.target.value }}" />`)}
                ${metaField('Event', html`<select class="select" @change="${(/** @type {any} */ e) => { meta.event = e.target.value }}">${HOOK_EVENTS.map((ev) => html`<option value="${ev}">${ev}</option>`.key(ev))}</select>`)}` : ''}
              ${s.type === 'route' ? html`
                ${metaField('Method', html`<select class="select" @change="${(/** @type {any} */ e) => { meta.method = e.target.value }}">${HTTP_METHODS.map((m) => html`<option value="${m}">${m}</option>`.key(m))}</select>`)}
                ${metaField('Path', html`<input class="input mono" value="/" @input="${(/** @type {any} */ e) => { meta.path = e.target.value }}" />`)}` : ''}
              ${s.type === 'job' ? html`
                ${metaField('Name', html`<input class="input" placeholder="nightly-cleanup" @input="${(/** @type {any} */ e) => { meta.name = e.target.value }}" />`)}
                ${metaField('Cron (UTC)', html`<input class="input mono" value="0 3 * * *" @input="${(/** @type {any} */ e) => { meta.cron = e.target.value }}" />`)}` : ''}
            </div>` : ''}
          <div class="flex-1 p-3">
            ${CodeEditor({ value: s.creating ? meta.code : (s.sel?.code || ''), language: 'javascript', height: 420, onChange: (v) => { draft = v; if (!s.dirty) s.dirty = true } })}
          </div>`}
      </div>`
  }

  return html`
    <div class="space-y-5">
      <div>
        <h1 class="font-display text-2xl font-semibold text-fg">Logic</h1>
        <p class="mt-0.5 text-sm text-fg-soft">Everything that runs your business rules — code on events & requests, schedules, outbound webhooks, and feature flags.</p>
      </div>

      <div class="flex flex-wrap gap-5 border-b border-line">${ORDER.map((t) => tabBtn(t))}</div>

      <div class="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div class="card flex flex-col">
          <div class="card-head"><span class="card-title">${() => TYPES[s.type].label}</span><button class="btn btn-primary btn-sm" @click="${startNew}">${Icon({ name: 'plus', size: 14 })} New</button></div>
          <div class="max-h-140 space-y-0.5 overflow-y-auto p-2">
            ${() => {
              const l = s.lists[s.type]
              if (l === null) return html`<div class="p-4 text-center text-sm text-fg-faint">Loading…</div>`
              if (!l.length) return html`<div class="p-6 text-center text-sm text-fg-faint">No ${TYPES[s.type].label.toLowerCase()} yet.</div>`
              return html`<div>${l.map((item) => rowItem(item).key(idOf(item)))}</div>`
            }}
          </div>
        </div>

        <div class="card min-h-130">
          ${() => (s.sel || s.creating) ? editorPane() : html`<div class="flex h-full min-h-120 items-center justify-center p-8 text-center text-sm text-fg-faint">Select an item to edit, or create a new one.</div>`}
        </div>
      </div>
    </div>
  `
}

export default LogicPage
