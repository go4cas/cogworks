import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../../framework/index.js'
import { useRoute } from '../../composables/useRoute.js'
import { useRouter } from '../../composables/useRouter.js'
import { useToast } from '../../composables/useToast.js'
import { api, parseFields } from '../../lib/api.js'
import { Icon } from '../../components/Icon.js'

export const meta = { layout: 'menu', title: 'Collection' }

/** @type {Record<string, string>} */
const KIND_COLOR = { base: 'var(--color-brand)', auth: 'var(--color-ok)', view: 'var(--color-warn)' }
const RULES = /** @type {const} */ ([
  ['list_rule', 'List'], ['view_rule', 'View'], ['create_rule', 'Create'], ['update_rule', 'Update'], ['delete_rule', 'Delete'],
])
const FIELD_TYPES = ['text', 'number', 'bool', 'email', 'url', 'date', 'json', 'select', 'relation', 'file']
const PER_PAGE = 20

const cell = (/** @type {any} */ v, /** @type {string} */ type) => {
  if (v === null || v === undefined || v === '') return html`<span class="text-fg-faint">—</span>`
  if (type === 'bool') return v ? html`<span style="color:var(--color-ok)">✓</span>` : html`<span class="text-fg-faint">✗</span>`
  if (type === 'date' || type === 'autodate') {
    const d = new Date(typeof v === 'number' ? v * 1000 : v)
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 16).replace('T', ' ')
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function CollectionDetail() {
  const route = useRoute()
  const router = useRouter()
  const id = route.params().id
  const toast = useToast()

  const s = reactive(
    /** @type {{ col:any, error:string, tab:string, records:any[]|null, editing:string|null, saving:boolean,
     *   page:number, totalPages:number, totalItems:number, search:string, fieldRows:{id:number}[] }} */
    ({ col: null, error: '', tab: 'records', records: null, editing: null, saving: false, page: 1, totalPages: 1, totalItems: 0, search: '', fieldRows: [] }),
  )
  // Plain buffers so keystrokes don't re-render forms.
  /** @type {Record<string,any>} */ let formInit = {}
  /** @type {Record<string,any>} */ let formVals = {}
  /** @type {Record<string,string>} */ let ruleVals = {}
  /** @type {Record<number,{name:string,type:string,required:boolean}>} */ let fieldDraft = {}
  let rowSeq = 0
  let searchTerm = ''
  let renameVal = ''

  const RULE_KEYS = /** @type {const} */ (['list_rule', 'view_rule', 'create_rule', 'update_rule', 'delete_rule'])
  const userFields = () => parseFields(s.col?.fields ?? '[]').filter((/** @type {any} */ f) => !f.system && !f.implicit)
  const editableFields = () => userFields()

  function syncFromCol() {
    ruleVals = {}
    for (const k of RULE_KEYS) ruleVals[k] = s.col[k] || ''
    renameVal = s.col.name
    fieldDraft = {}
    rowSeq = 0
    const rows = []
    for (const f of userFields()) {
      const rid = rowSeq++
      fieldDraft[rid] = { name: f.name, type: f.type, required: !!f.required }
      rows.push({ id: rid })
    }
    s.fieldRows = rows
  }

  api.get(`/api/v1/collections/${id}`).then((r) => {
    const d = /** @type {any} */ (r)
    if (d?.error) { s.error = d.error; return }
    s.col = d?.data ?? null
    if (s.col) { syncFromCol(); loadRecords() }
  }).catch((/** @type {any} */ e) => { s.error = e?.message || 'Failed to load' })

  function loadRecords() {
    const q = new URLSearchParams({ perPage: String(PER_PAGE), page: String(s.page) })
    const term = s.search.trim().replace(/"/g, '')
    if (term) {
      const tf = userFields().filter((/** @type {any} */ f) => ['text', 'email', 'url'].includes(f.type)).map((/** @type {any} */ f) => f.name)
      if (tf.length) q.set('filter', tf.map((f) => `${f} ~ "${term}"`).join(' || '))
    }
    api.get(`/api/v1/${s.col.name}?${q}`).then((r) => {
      const d = /** @type {any} */ (r)
      s.records = d?.data ?? []
      s.totalPages = d?.totalPages ?? 1
      s.totalItems = d?.totalItems ?? (d?.data?.length ?? 0)
    }).catch(() => { s.records = [] })
  }
  const goPage = (/** @type {number} */ p) => { if (p >= 1 && p <= s.totalPages && p !== s.page) { s.page = p; loadRecords() } }
  const runSearch = (/** @type {string} */ t) => { s.search = t; s.page = 1; loadRecords() }

  // ── records CRUD ──
  function openForm(/** @type {any} */ rec) {
    formInit = {}; formVals = {}
    for (const f of editableFields()) {
      const v = rec ? (rec[f.name] ?? '') : ''
      formInit[f.name] = f.type === 'bool' ? !!v : v
      formVals[f.name] = formInit[f.name]
    }
    s.editing = rec ? rec.id : 'new'
  }
  function coerce() {
    /** @type {Record<string,any>} */ const out = {}
    for (const f of editableFields()) {
      let v = formVals[f.name]
      if (f.type === 'number') v = v === '' || v === null ? null : Number(v)
      else if (f.type === 'bool') v = !!v
      out[f.name] = v
    }
    return out
  }
  async function saveRecord() {
    if (s.saving) return
    s.saving = true
    try {
      if (s.editing === 'new') await api.post(`/api/v1/${s.col.name}`, coerce())
      else await api.patch(`/api/v1/${s.col.name}/${s.editing}`, coerce())
      s.editing = null; toast.success('Saved'); loadRecords()
    } catch (/** @type {any} */ e) { toast.error(e?.message || 'Save failed') } finally { s.saving = false }
  }
  async function deleteRecord(/** @type {string} */ rid) {
    if (!globalThis.confirm('Delete this record?')) return
    try { await api.delete(`/api/v1/${s.col.name}/${rid}`); toast.success('Deleted'); loadRecords() } catch (/** @type {any} */ e) { toast.error(e?.message || 'Delete failed') }
  }

  // ── schema ──
  const addFieldRow = () => { const rid = rowSeq++; fieldDraft[rid] = { name: '', type: 'text', required: false }; s.fieldRows = [...s.fieldRows, { id: rid }] }
  const removeFieldRow = (/** @type {number} */ rid) => { delete fieldDraft[rid]; s.fieldRows = s.fieldRows.filter((r) => r.id !== rid) }
  async function saveSchema() {
    if (s.saving) return
    const fields = s.fieldRows.map((r) => fieldDraft[r.id]).filter((f) => f && f.name.trim())
      .map((f) => ({ name: f.name.trim(), type: f.type, ...(f.required ? { required: true } : {}) }))
    s.saving = true
    try {
      const r = /** @type {any} */ (await api.patch(`/api/v1/collections/${s.col.id}`, { fields }))
      if (r?.error) throw new Error(r.error)
      if (r?.data) { s.col = r.data; syncFromCol() }
      toast.success('Schema saved'); loadRecords()
    } catch (/** @type {any} */ e) { toast.error(e?.message || 'Save failed') } finally { s.saving = false }
  }
  async function saveRules() {
    if (s.saving) return
    s.saving = true
    try {
      /** @type {Record<string,any>} */ const body = {}
      for (const k of RULE_KEYS) body[k] = ruleVals[k].trim() === '' ? null : ruleVals[k].trim()
      const r = /** @type {any} */ (await api.patch(`/api/v1/collections/${s.col.id}`, body))
      if (r?.error) throw new Error(r.error)
      if (r?.data) { s.col = r.data; syncFromCol() }
      toast.success('Rules saved')
    } catch (/** @type {any} */ e) { toast.error(e?.message || 'Save failed') } finally { s.saving = false }
  }
  async function renameCollection() {
    if (!renameVal.trim() || renameVal.trim() === s.col.name) return
    try {
      const r = /** @type {any} */ (await api.patch(`/api/v1/collections/${s.col.id}`, { name: renameVal.trim() }))
      if (r?.error) throw new Error(r.error)
      if (r?.data) { s.col = r.data; syncFromCol(); loadRecords() }
      toast.success('Renamed')
    } catch (/** @type {any} */ e) { toast.error(e?.message || 'Rename failed') }
  }
  async function deleteCollection() {
    if (!globalThis.confirm(`Delete collection "${s.col.name}" and ALL its records? This cannot be undone.`)) return
    try { await api.delete(`/api/v1/collections/${s.col.id}`); toast.success('Collection deleted'); router.go('/collections') } catch (/** @type {any} */ e) { toast.error(e?.message || 'Delete failed') }
  }

  const tabBtn = (/** @type {string} */ id2, /** @type {string} */ label) => html`
    <button @click="${() => { s.tab = id2 }}" class="${() => `border-b-2 px-1 pb-2.5 pt-1 text-sm font-medium transition-colors ${s.tab === id2 ? 'border-brand text-fg' : 'border-transparent text-fg-faint hover:text-fg-soft'}`}">${label}</button>`

  const origin = () => globalThis.location.origin

  return html`
    <div class="space-y-5">
      <div>
        <button @click="${() => router.go('/collections')}" class="flex items-center gap-1 text-xs text-fg-faint hover:text-fg-soft">${Icon({ name: 'chevronLeft', size: 13 })} Data</button>
        ${() => s.error
          ? html`<h1 class="mt-2 font-display text-xl font-semibold" style="color:var(--color-bad)">${s.error}</h1>`
          : html`
            <div class="mt-2 flex flex-wrap items-center gap-3">
              <h1 class="font-display text-2xl font-semibold text-fg">${() => s.col?.name ?? '…'}</h1>
              ${() => s.col ? html`<span class="badge" style="${`color:${KIND_COLOR[s.col.type] ?? 'var(--color-brand)'}`}"><span class="dot" style="${`background:${KIND_COLOR[s.col.type] ?? 'var(--color-brand)'}`}"></span>${s.col.type}</span>` : ''}
              <span class="mono text-xs text-fg-faint">${() => (s.col ? `cw_${s.col.name} · ${s.totalItems} records` : '')}</span>
            </div>`}
      </div>

      ${() => !s.col ? '' : html`
        <div class="flex gap-5 border-b border-line">
          ${tabBtn('records', 'Records')}
          ${tabBtn('fields', 'Fields')}
          ${tabBtn('rules', 'Rules')}
          ${tabBtn('api', 'API')}
        </div>

        ${() => s.tab === 'records' ? recordsTab()
          : s.tab === 'fields' ? fieldsTab()
          : s.tab === 'rules' ? rulesTab()
          : apiTab()}
      `}
    </div>
  `

  function recordsTab() {
    return html`
      <div class="space-y-4">
        <div class="flex items-center gap-2">
          <div class="relative flex-1 max-w-xs">
            <span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">${Icon({ name: 'search', size: 14 })}</span>
            <input class="input pl-8" placeholder="Search records…" @input="${(/** @type {any} */ e) => { searchTerm = e.target.value }}" @keydown="${(/** @type {any} */ e) => { if (e.key === 'Enter') runSearch(searchTerm) }}" />
          </div>
          <span class="mono text-xs text-fg-faint">${() => `${s.totalItems} total`}</span>
          <div class="ml-auto flex items-center gap-2">
            ${s.col.type !== 'view' ? html`<button class="btn btn-primary btn-sm" @click="${() => openForm(null)}">${Icon({ name: 'plus', size: 14 })} New record</button>` : html`<span class="badge text-fg-faint">read-only view</span>`}
          </div>
        </div>

        ${() => s.editing ? recordForm() : ''}

        <div class="card overflow-hidden">
          ${() => {
            if (s.records === null) return html`<div class="p-8 text-center text-sm text-fg-faint">Loading…</div>`
            if (!s.records.length) return html`<div class="p-8 text-center text-sm text-fg-faint">${s.search ? 'No records match.' : 'No records yet.'}</div>`
            const cols = userFields()
            const gtc = `10rem ${cols.map(() => 'minmax(9rem,1fr)').join(' ')} 5rem`
            return html`
              <div class="overflow-x-auto">
                <div class="min-w-max">
                  <div class="grid thead" style="${`grid-template-columns:${gtc}`}">
                    <div class="tcell py-2!">id</div>
                    ${cols.map((/** @type {any} */ c) => html`<div class="tcell py-2!">${c.name}</div>`.key(c.name))}
                    <div class="tcell py-2!"></div>
                  </div>
                  ${s.records.map((rec) => html`
                    <div class="grid trow" style="${`grid-template-columns:${gtc}`}">
                      <div class="tcell tcell-mono truncate text-fg-faint">${String(rec.id).slice(0, 8)}</div>
                      ${cols.map((/** @type {any} */ c) => html`<div class="tcell truncate text-sm text-fg-soft">${cell(rec[c.name], c.type)}</div>`.key(c.name))}
                      <div class="tcell flex items-center justify-end gap-0.5">
                        ${s.col.type !== 'view' ? html`<button class="btn btn-ghost btn-icon" title="Edit" @click="${() => openForm(rec)}">${Icon({ name: 'edit', size: 14 })}</button>` : ''}
                        ${s.col.type !== 'view' ? html`<button class="btn btn-ghost btn-icon" title="Delete" @click="${() => deleteRecord(rec.id)}">${Icon({ name: 'trash', size: 14 })}</button>` : ''}
                      </div>
                    </div>`.key(rec.id))}
                </div>
              </div>
              ${s.totalPages > 1 ? html`
                <div class="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-fg-faint">
                  <span>Page ${() => s.page} of ${() => s.totalPages}</span>
                  <div class="flex gap-1">
                    <button class="btn btn-secondary btn-sm" aria-disabled="${() => (s.page <= 1 ? 'true' : 'false')}" @click="${() => goPage(s.page - 1)}">${Icon({ name: 'chevronLeft', size: 13 })} Prev</button>
                    <button class="btn btn-secondary btn-sm" aria-disabled="${() => (s.page >= s.totalPages ? 'true' : 'false')}" @click="${() => goPage(s.page + 1)}">Next ${Icon({ name: 'chevronRight', size: 13 })}</button>
                  </div>
                </div>` : ''}`
          }}
        </div>
      </div>`
  }

  function recordForm() {
    return html`
      <div class="card card-pad space-y-3">
        <div class="card-title">${s.editing === 'new' ? 'New record' : 'Edit record'}</div>
        <div class="grid gap-3 sm:grid-cols-2">
          ${editableFields().map((/** @type {any} */ f) => html`
            <label class="block space-y-1">
              <span class="field-label">${f.name} <span class="font-normal text-fg-faint">${f.type}</span></span>
              ${f.type === 'bool'
                ? (formInit[f.name]
                    ? html`<div><input type="checkbox" checked @change="${(/** @type {any} */ e) => { formVals[f.name] = e.target.checked }}" /></div>`
                    : html`<div><input type="checkbox" @change="${(/** @type {any} */ e) => { formVals[f.name] = e.target.checked }}" /></div>`)
                : html`<input class="input" type="${f.type === 'number' ? 'number' : 'text'}" value="${formInit[f.name] ?? ''}" @input="${(/** @type {any} */ e) => { formVals[f.name] = e.target.value }}" />`}
            </label>`.key(f.name))}
        </div>
        <div class="flex gap-2">
          <button class="btn btn-primary" aria-disabled="${() => (s.saving ? 'true' : 'false')}" @click="${saveRecord}">${() => (s.saving ? 'Saving…' : 'Save')}</button>
          <button class="btn btn-ghost" @click="${() => { s.editing = null }}">Cancel</button>
        </div>
      </div>`
  }

  function fieldsTab() {
    return html`
      <div class="space-y-4">
        <div class="card">
          <div class="card-head"><span class="card-title">Fields</span><button class="btn btn-primary btn-sm" aria-disabled="${() => (s.saving ? 'true' : 'false')}" @click="${saveSchema}">${() => (s.saving ? 'Saving…' : 'Save changes')}</button></div>
          <div class="grid thead" style="grid-template-columns:1.4fr 1fr auto auto">
            <div class="tcell py-2!">Name</div><div class="tcell py-2!">Type</div><div class="tcell py-2!">Required</div><div class="tcell py-2!"></div>
          </div>
          ${() => s.fieldRows.map((row) => html`
            <div class="grid trow items-center" style="grid-template-columns:1.4fr 1fr auto auto">
              <div class="tcell"><input class="input" value="${fieldDraft[row.id]?.name ?? ''}" @input="${(/** @type {any} */ e) => { fieldDraft[row.id].name = e.target.value }}" /></div>
              <div class="tcell"><select class="select" @change="${(/** @type {any} */ e) => { fieldDraft[row.id].type = e.target.value }}">${[fieldDraft[row.id]?.type ?? 'text', ...FIELD_TYPES.filter((t) => t !== (fieldDraft[row.id]?.type ?? 'text'))].map((t) => html`<option value="${t}">${t}</option>`.key(t))}</select></div>
              <div class="tcell">${fieldDraft[row.id]?.required
                ? html`<input type="checkbox" checked @change="${(/** @type {any} */ e) => { fieldDraft[row.id].required = e.target.checked }}" />`
                : html`<input type="checkbox" @change="${(/** @type {any} */ e) => { fieldDraft[row.id].required = e.target.checked }}" />`}</div>
              <div class="tcell text-right"><button class="btn btn-ghost btn-icon" title="Remove" @click="${() => removeFieldRow(row.id)}">${Icon({ name: 'trash', size: 14 })}</button></div>
            </div>`.key(row.id))}
          <div class="p-3"><button class="btn btn-secondary btn-sm" @click="${addFieldRow}">${Icon({ name: 'plus', size: 14 })} Add field</button></div>
        </div>

        <div class="card card-pad space-y-4">
          <div class="card-title" style="color:var(--color-bad)">Danger zone</div>
          <div class="flex flex-wrap items-end gap-2">
            <label class="space-y-1"><span class="field-label">Rename collection</span><input class="input" style="min-width:16rem" value="${s.col.name}" @input="${(/** @type {any} */ e) => { renameVal = e.target.value }}" /></label>
            <button class="btn btn-secondary" @click="${renameCollection}">Rename</button>
          </div>
          <div class="flex items-center justify-between rounded-control border border-line px-4 py-3">
            <div><div class="text-sm font-medium text-fg">Delete this collection</div><div class="text-xs text-fg-faint">Drops the table and all records. Irreversible.</div></div>
            <button class="btn btn-danger" @click="${deleteCollection}">${Icon({ name: 'trash', size: 14 })} Delete collection</button>
          </div>
        </div>
      </div>`
  }

  function rulesTab() {
    return html`
      <div class="card card-pad space-y-4">
        <div class="flex items-center justify-between"><span class="card-title">Access rules</span><button class="btn btn-primary btn-sm" aria-disabled="${() => (s.saving ? 'true' : 'false')}" @click="${saveRules}">${() => (s.saving ? 'Saving…' : 'Save rules')}</button></div>
        <p class="text-xs text-fg-faint">Empty = public. Use a filter expression, e.g. <span class="mono text-fg-soft">@request.auth.id != ""</span>. Leave blank for open access.</p>
        <div class="space-y-2">
          ${RULES.map(([key, label]) => html`
            <div class="flex items-center gap-3">
              <span class="w-16 shrink-0 text-sm text-fg-soft">${label}</span>
              <input class="input mono" style="font-size:0.8rem" placeholder="public — no rule" value="${ruleVals[key] ?? ''}" @input="${(/** @type {any} */ e) => { ruleVals[key] = e.target.value }}" />
            </div>`.key(key))}
        </div>
      </div>`
  }

  function apiTab() {
    const name = s.col.name
    const eps = [
      ['GET', `/api/v1/${name}`, 'List records (filter, sort, page)'],
      ['GET', `/api/v1/${name}/:id`, 'Get one record'],
      ['POST', `/api/v1/${name}`, 'Create a record'],
      ['PATCH', `/api/v1/${name}/:id`, 'Update a record'],
      ['DELETE', `/api/v1/${name}/:id`, 'Delete a record'],
    ]
    const mcolor = (/** @type {string} */ m) => m === 'GET' ? 'var(--color-ok)' : m === 'DELETE' ? 'var(--color-bad)' : m === 'POST' ? 'var(--color-info)' : 'var(--color-warn)'
    const curl = `curl ${origin()}/api/v1/${name} \\\n  -H "Authorization: Bearer <API_TOKEN>"`
    const js = `import Cogworks from '@cogworks/sdk'\nconst cw = new Cogworks('${origin()}', '<API_TOKEN>')\n\nconst { data } = await cw.collection('${name}').list({ page: 1, perPage: 20 })`
    return html`
      <div class="space-y-4">
        <div class="card overflow-hidden">
          <div class="card-head"><span class="card-title">REST endpoints</span><span class="mono text-xs text-fg-faint">base: ${origin()}</span></div>
          <div class="grid thead" style="grid-template-columns:5rem 2fr 2fr"><div class="tcell py-2!">Method</div><div class="tcell py-2!">Path</div><div class="tcell py-2!">Description</div></div>
          ${eps.map(([m, path, desc]) => html`
            <div class="grid trow" style="grid-template-columns:5rem 2fr 2fr">
              <div class="tcell"><span class="mono text-xs font-semibold" style="${`color:${mcolor(m)}`}">${m}</span></div>
              <div class="tcell tcell-mono truncate text-fg">${path}</div>
              <div class="tcell truncate text-sm text-fg-soft">${desc}</div>
            </div>`.key(path + m))}
        </div>
        <div class="grid gap-4 lg:grid-cols-2">
          ${snippet('cURL', curl)}
          ${snippet('JavaScript SDK', js)}
        </div>
        <p class="text-xs text-fg-faint">Full reference for every collection lives under <button class="text-brand hover:underline" @click="${() => router.go('/api-docs')}">API Docs</button>.</p>
      </div>`
  }

  function snippet(/** @type {string} */ title, /** @type {string} */ code) {
    return html`
      <div class="card overflow-hidden">
        <div class="card-head"><span class="card-title">${title}</span><button class="btn btn-ghost btn-sm" @click="${() => { navigator.clipboard?.writeText(code); toast.success('Copied') }}">${Icon({ name: 'copy', size: 13 })} Copy</button></div>
        <pre class="overflow-x-auto bg-surface-inset p-4 text-xs leading-relaxed text-fg-soft"><code class="mono">${code}</code></pre>
      </div>`
  }
}

export default CollectionDetail
