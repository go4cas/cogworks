import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useToast } from '../composables/useToast.js'
import { api, getToken } from '../lib/api.js'
import { Icon } from '../components/Icon.js'

export const meta = { layout: 'menu', title: 'Operations' }

function OperationsPage() {
  useMeta({ title: 'Operations · Cogworks' })
  const toast = useToast()
  const s = reactive(/** @type {{ busy:string, snapshot:any }} */ ({ busy: '', snapshot: null }))

  async function downloadBackup() {
    s.busy = 'backup'
    try {
      const res = await fetch('/api/v1/admin/backup', { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error(`Backup failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `cogworks-backup-${new Date().toISOString().slice(0, 10)}.db`; a.click()
      URL.revokeObjectURL(url)
      toast.success('Backup downloaded')
    } catch (/** @type {any} */ e) { toast.error(e?.message || 'Backup failed') } finally { s.busy = '' }
  }

  async function restore(/** @type {any} */ e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!globalThis.confirm(`Restore from "${file.name}"? This OVERWRITES the current database. The server may need a restart.`)) { e.target.value = ''; return }
    s.busy = 'restore'
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/v1/admin/restore', { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.error) throw new Error(j?.error || `Restore failed (${res.status})`)
      toast.success('Restore complete')
    } catch (/** @type {any} */ err) { toast.error(err?.message || 'Restore failed') } finally { s.busy = ''; e.target.value = '' }
  }

  async function loadSnapshot() {
    s.busy = 'snapshot'
    try {
      const r = /** @type {any} */ (await api.get('/api/v1/admin/migrations/snapshot'))
      if (r?.error) throw new Error(r.error)
      s.snapshot = r?.data ?? r
    } catch (/** @type {any} */ e) { toast.error(e?.message || 'Failed') } finally { s.busy = '' }
  }
  function downloadSnapshot() {
    const blob = new Blob([JSON.stringify(s.snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'cogworks-schema-snapshot.json'; a.click()
    URL.revokeObjectURL(url)
  }

  return html`
    <div class="space-y-5">
      <div>
        <h1 class="font-display text-2xl font-semibold text-fg">Operations</h1>
        <p class="mt-0.5 text-sm text-fg-soft">Backups, restores, and schema snapshots for your Cogworks server.</p>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="card card-pad space-y-3">
          <div class="card-title">Backup</div>
          <p class="text-sm text-fg-soft">Download a consistent snapshot of the entire SQLite database — schema, records, settings, and tokens.</p>
          <button class="btn btn-primary" aria-disabled="${() => (s.busy === 'backup' ? 'true' : 'false')}" @click="${downloadBackup}">${Icon({ name: 'external', size: 14 })} ${() => (s.busy === 'backup' ? 'Preparing…' : 'Download backup')}</button>
        </div>

        <div class="card card-pad space-y-3">
          <div class="card-title" style="color:var(--color-bad)">Restore</div>
          <p class="text-sm text-fg-soft">Replace the current database with a backup file. <span class="text-fg">Overwrites everything</span> — use with care.</p>
          <label class="btn btn-danger cursor-pointer">
            ${Icon({ name: 'refresh', size: 14 })} ${() => (s.busy === 'restore' ? 'Restoring…' : 'Restore from file')}
            <input type="file" accept=".db,.sqlite,.sqlite3" class="hidden" @change="${restore}" />
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <span class="card-title">Schema snapshot</span>
          <div class="flex gap-2">
            <button class="btn btn-secondary btn-sm" aria-disabled="${() => (s.busy === 'snapshot' ? 'true' : 'false')}" @click="${loadSnapshot}">${() => (s.busy === 'snapshot' ? 'Loading…' : 'Load current')}</button>
            ${() => s.snapshot ? html`<button class="btn btn-secondary btn-sm" @click="${downloadSnapshot}">${Icon({ name: 'external', size: 13 })} Download JSON</button>` : ''}
          </div>
        </div>
        <div class="card-pad">
          <p class="mb-3 text-sm text-fg-soft">A portable description of your collections + fields. Use it to diff and apply schema migrations across environments via the CLI (<span class="mono">cogworks migrate</span>).</p>
          ${() => s.snapshot
            ? html`<pre class="tscroll overflow-x-auto rounded-control bg-surface-inset p-4 text-xs text-fg-soft"><code class="mono">${JSON.stringify(s.snapshot, null, 2)}</code></pre>`
            : html`<div class="rounded-control border border-dashed border-line-strong p-6 text-center text-sm text-fg-faint">Load the current schema snapshot to view or download it.</div>`}
        </div>
      </div>
    </div>
  `
}

export default OperationsPage
