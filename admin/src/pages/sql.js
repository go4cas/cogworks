import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { api } from '../lib/api.js'
import { CodeEditor } from '../components/CodeEditor.js'
import { Icon } from '../components/Icon.js'

export const meta = { layout: 'menu', title: 'SQL' }

function SqlPage() {
  useMeta({ title: 'SQL · Cogworks' })

  const s = reactive(
    /** @type {{ mode: 'readonly'|'sandbox', running: boolean, result: any, error: string, tables: string[] }} */
    ({ mode: 'readonly', running: false, result: null, error: '', tables: [] }),
  )
  let sql = "SELECT name, type FROM sqlite_schema WHERE type = 'table' ORDER BY name;"

  api.get('/api/v1/collections')
    .then((r) => { s.tables = (/** @type {any} */ (r)?.data ?? []).map((/** @type {any} */ c) => `cw_${c.name}`) })
    .catch(() => {})

  async function run() {
    if (s.running) return
    s.running = true; s.error = ''
    try {
      const r = /** @type {any} */ (await api.post('/api/v1/admin/sql/run', { sql, mode: s.mode }))
      if (r?.error) { s.error = r.error; s.result = null }
      else { s.result = r?.data ?? null; if (s.result && s.result.ok === false) s.error = s.result.error || 'Query failed' }
    } catch (/** @type {any} */ e) { s.error = e?.message || 'Request failed' } finally { s.running = false }
  }

  const modeBtn = (/** @type {'readonly'|'sandbox'} */ m, /** @type {string} */ label) =>
    html`<button @click="${() => { s.mode = m }}" class="${() => `btn btn-sm ${s.mode === m ? 'btn-primary' : 'btn-secondary'}`}">${label}</button>`

  return html`
    <div class="space-y-4">
      <div class="flex items-end justify-between">
        <div>
          <h1 class="font-display text-2xl font-semibold text-fg">SQL editor</h1>
          <p class="mt-0.5 text-sm text-fg-soft">Query live data read-only, or write against a throwaway sandbox copy.</p>
        </div>
        <div class="flex items-center gap-1.5">${modeBtn('readonly', 'Read-only')}${modeBtn('sandbox', 'Sandbox')}</div>
      </div>

      <div class="card overflow-hidden">
        ${CodeEditor({ value: sql, language: 'sql', height: 240, onChange: (v) => { sql = v }, tables: () => s.tables })}
        <div class="flex items-center gap-3 border-t border-line px-3 py-2.5">
          <button class="btn btn-primary btn-sm" aria-disabled="${() => (s.running ? 'true' : 'false')}" @click="${run}">${Icon({ name: 'play', size: 13, fill: true })} ${() => (s.running ? 'Running…' : 'Run')}</button>
          ${() => (s.result && s.result.ok !== false ? html`<span class="mono text-xs text-fg-faint">${s.result.rowCount} rows · ${Math.round(s.result.durationMs)}ms${s.result.truncated ? ' · truncated' : ''}</span>` : '')}
        </div>
      </div>

      ${() => (s.error ? html`<div class="rounded-panel border px-4 py-3 mono text-xs" style="border-color:var(--color-bad);color:var(--color-bad);background:color-mix(in srgb, var(--color-bad) 8%, transparent)">${s.error}</div>` : '')}

      ${() =>
        s.result && s.result.ok !== false && s.result.columns?.length
          ? html`
            <div class="card overflow-auto">
              <div class="min-w-max">
                <div class="flex thead">
                  ${s.result.columns.map((/** @type {string} */ col) => html`<div class="tcell tcell-mono min-w-36 flex-1 whitespace-nowrap py-2!">${col}</div>`.key(col))}
                </div>
                ${s.result.rows.map((/** @type {any[]} */ row, /** @type {number} */ i) =>
                  html`<div class="flex trow">
                    ${row.map((cell, /** @type {number} */ j) => html`<div class="tcell tcell-mono min-w-36 flex-1 whitespace-nowrap text-fg-soft">${cell === null ? html`<span class="text-fg-faint">null</span>` : String(cell)}</div>`.key(j))}
                  </div>`.key(i),
                )}
              </div>
            </div>`
          : ''}
    </div>
  `
}

export default SqlPage
