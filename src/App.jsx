import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { api, pending, ls, login } from './api.js'

const ST = {
  ok:  { l: 'OK',      long: 'Satisfactory',   c: 'ok',  g: '✓', r: 1 },
  mon: { l: 'Monitor', long: 'Monitor',        c: 'mon', g: 'M', r: 2 },
  act: { l: 'Action',  long: 'Action needed',  c: 'act', g: 'A', r: 3 },
  na:  { l: 'N/A',     long: 'Not applicable', c: 'na',  g: '–', r: 0 }
}
const ORDER = ['ok', 'mon', 'act', 'na']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}` }
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
const worstOf = (items) => {
  let w = ''
  for (const k in items) { const s = items[k]?.status; if (s && ST[s] && (!w || ST[s].r > ST[w].r)) w = s }
  return w
}
const blankForm = (area = '') => ({ id: null, area, date: today(), inspector: ls('ranger-name') || '', items: {}, comments: '' })

const cachedSetup = () => { try { return JSON.parse(ls('ranger-setup') || 'null') } catch { return null } }

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => !!login.get())
  const [loginNote, setLoginNote] = useState('')
  const logout = useCallback((note) => {
    login.set('')
    try { sessionStorage.removeItem('ranger-admin') } catch {}
    setLoginNote(note || '')
    setLoggedIn(false)
  }, [])
  if (!loggedIn) {
    return <LoginScreen note={loginNote} onLogin={() => { setLoginNote(''); setLoggedIn(true) }} />
  }
  return <Main onLogout={logout} />
}

function LoginScreen({ note, onLogin }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(note)
  const submit = async (e) => {
    e.preventDefault()
    if (!pw) return
    setBusy(true); setMsg('')
    try {
      const data = await api.load(pw)
      login.set(pw)
      ls('ranger-setup', JSON.stringify(data.setup))
      onLogin()
    } catch (err) {
      setMsg(err.status === 401 ? 'That password isn’t right.' : err.offline ? 'No signal — you need a connection to log in the first time.' : "Couldn't log in: " + err.message)
    } finally { setBusy(false) }
  }
  return (
    <div className="wrap">
      <form className="login" onSubmit={submit}>
        <div className="logo-plate big"><img src="/logo.jpg" alt="Datchworth Parish Council" /></div>
        <h1>Ranger Inspections</h1>
        <label className="f">Password
          <input id="login-pw" type="password" value={pw} autoFocus autoComplete="current-password" onChange={(e) => setPw(e.target.value)} />
        </label>
        {msg && <div className="banner err" style={{ marginTop: 0 }}>{msg}</div>}
        <button className="btn" type="submit" disabled={busy || !pw}>{busy ? 'Checking…' : 'Log in'}</button>
        <p className="hint" style={{ margin: 0 }}>You'll stay logged in on this device.</p>
      </form>
    </div>
  )
}

function Main({ onLogout }) {
  const [tab, setTab] = useState(() => ls('ranger-tab') || 'inspect')
  const [setup, setSetup] = useState(cachedSetup)
  const [inspections, setInspections] = useState([])
  const [status, setStatus] = useState('loading') // loading | online | offline
  const [loadError, setLoadError] = useState('')
  const [queued, setQueued] = useState(() => pending.get())
  const [form, setForm] = useState(() => blankForm())
  const [toastMsg, setToastMsg] = useState('')
  const [adminPw, setAdminPw] = useState(() => { try { return sessionStorage.getItem('ranger-admin') || '' } catch { return '' } })

  const toast = useCallback((m) => {
    setToastMsg(m)
    clearTimeout(toast._t)
    toast._t = setTimeout(() => setToastMsg(''), 3000)
  }, [])

  const go = (t) => { setTab(t); ls('ranger-tab', t) }

  const refresh = useCallback(async () => {
    try {
      const data = await api.load()
      setSetup(data.setup)
      ls('ranger-setup', JSON.stringify(data.setup))
      setInspections(data.inspections || [])
      setStatus('online')
      setLoadError('')
      return true
    } catch (e) {
      if (e.status === 401) { onLogout('The password has changed — please log in again.'); return false }
      setStatus('offline')
      setLoadError(e.offline ? '' : e.message)
      return false
    }
  }, [onLogout])

  // Upload anything saved on this device while offline.
  const flush = useCallback(async () => {
    const q = pending.get()
    if (!q.length) return
    const left = []
    let loggedOut = false
    for (const rec of q) {
      if (loggedOut) { left.push(rec); continue }
      try { await api.saveInspection(rec) } catch (e) { left.push(rec); if (e.status === 401) loggedOut = true }
    }
    pending.set(left)
    setQueued(left)
    if (loggedOut) { onLogout('The password has changed — log in again and your saved inspections will upload.'); return }
    if (left.length < q.length) {
      toast(`${q.length - left.length} saved inspection${q.length - left.length > 1 ? 's' : ''} uploaded`)
      refresh()
    }
  }, [refresh, toast, onLogout])

  useEffect(() => {
    refresh().then((ok) => ok && flush())
    const onOnline = () => refresh().then((ok) => ok && flush())
    window.addEventListener('online', onOnline)
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 60000)
    return () => { window.removeEventListener('online', onOnline); clearInterval(t) }
  }, [refresh, flush])

  const areas = setup?.areas || []
  const checks = setup?.checks || []

  const allInspections = useMemo(() => {
    const ids = new Set(inspections.map((i) => i.id))
    return [...inspections, ...queued.filter((q) => !ids.has(q.id)).map((q) => ({ ...q, _pending: true }))]
  }, [inspections, queued])

  const openInspection = (rec) => {
    setForm({
      id: rec.id, area: rec.area, date: rec.date, inspector: rec.inspector || '',
      comments: rec.comments || '', items: JSON.parse(JSON.stringify(rec.items || {})), createdAt: rec.createdAt
    })
    go('inspect')
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <div className="logo-plate"><img src="/logo.jpg" alt="Datchworth Parish Council" /></div>
          <div className="brand-text">
          <h1>Ranger Inspections</h1>
          <small>
            <button className="addnote" style={{ marginRight: 10, font: '500 12px var(--mono)' }} onClick={() => onLogout()}>Log out</button>
            {status === 'loading' ? 'Connecting…' : status === 'online'
              ? `${inspections.length} inspection${inspections.length === 1 ? '' : 's'} on record`
              : 'Offline'}
          </small>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {[['inspect', 'Inspect'], ['history', 'History'], ['year', 'Year sheet']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => go(k)}>{l}</button>
          ))}
        </nav>
      </header>

      {status === 'offline' && (
        <div className={'banner' + (loadError ? ' err' : '')}>
          {loadError
            ? <>Couldn't reach the inspection records: <b>{loadError}</b>. You can still complete inspections — they're kept on this device and upload once the problem is fixed. <button className="addnote" onClick={() => refresh().then((ok) => ok && flush())}>Try again</button></>
            : <>No signal right now. You can still complete inspections — they're kept on this device and upload automatically when you're back online.</>}
        </div>
      )}
      {queued.length > 0 && (
        <div className="banner">
          {queued.length} inspection{queued.length > 1 ? 's' : ''} saved on this device, waiting to upload.{' '}
          {status === 'online' && <button className="addnote" onClick={flush}>Upload now</button>}
        </div>
      )}

      {status === 'loading' && !setup && <section className="view"><div className="empty">Loading…</div></section>}
      {status === 'offline' && !setup && <OfflineSetupNote />}

      {setup && tab === 'inspect' && (
        <InspectView
          areas={areas} checks={checks} form={form} setForm={setForm} toast={toast}
          online={status === 'online'} adminPw={adminPw} onLogout={onLogout}
          onSaved={(rec, wasQueued) => {
            if (wasQueued) setQueued(pending.get())
            else setInspections((list) => [rec, ...list.filter((i) => i.id !== rec.id)])
            setForm(blankForm(rec.area))
            window.scrollTo({ top: 0 })
          }}
          onDeleted={(id) => { setInspections((l) => l.filter((i) => i.id !== id)); setForm(blankForm()) }}
        />
      )}
      {setup && tab === 'inspect' && (
        <AdminPanel
          setup={setup} setSetup={setSetup} adminPw={adminPw}
          setAdminPw={(pw) => { setAdminPw(pw); try { pw ? sessionStorage.setItem('ranger-admin', pw) : sessionStorage.removeItem('ranger-admin') } catch {} }}
          toast={toast} online={status === 'online'}
        />
      )}
      {setup && tab === 'history' && <HistoryView areas={areas} list={allInspections} onOpen={openInspection} />}
      {setup && tab === 'year' && <YearView areas={areas} checks={checks} list={allInspections} onOpen={openInspection} />}

      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  )
}

function OfflineSetupNote() {
  return (
    <section className="view">
      <div className="empty">This device hasn't loaded the list of areas yet. Open the app once with a signal and it will then work offline.</div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function InspectView({ areas, checks, form, setForm, toast, online, adminPw, onLogout, onSaved, onDeleted }) {
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [openNotes, setOpenNotes] = useState({})
  useEffect(() => { setConfirmDel(false); setOpenNotes({}) }, [form.id])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setItem = (id, patch) => setForm((f) => ({ ...f, items: { ...f.items, [id]: { ...(f.items[id] || {}), ...patch } } }))

  const counts = { ok: 0, mon: 0, act: 0, na: 0 }
  let done = 0
  checks.forEach((c) => { const s = form.items[c.id]?.status; if (s) { counts[s]++; done++ } })

  const save = async () => {
    if (!form.area) { toast('Choose an area first'); return }
    if (!form.date) { toast('Add the inspection date'); return }
    const marked = checks.filter((c) => form.items[c.id]?.status)
    if (!marked.length) { toast('Mark at least one check before saving'); return }
    const items = {}
    marked.forEach((c) => { const it = form.items[c.id]; items[c.id] = { status: it.status, note: (it.note || '').trim(), label: c.label } })
    const now = new Date().toISOString()
    const rec = {
      id: form.id || newId(), area: form.area, date: form.date, inspector: (form.inspector || '').trim(),
      items, comments: (form.comments || '').trim(), worst: worstOf(items),
      createdAt: form.createdAt || now, updatedAt: now
    }
    if (rec.inspector) ls('ranger-name', rec.inspector)
    setSaving(true)
    try {
      const saved = await api.saveInspection(rec)
      toast(form.id ? 'Changes saved' : 'Inspection saved')
      onSaved(saved || rec, false)
    } catch (e) {
      if (e.offline || !online || e.status === 401 || (e.status && e.status >= 500)) {
        const q = pending.get().filter((p) => p.id !== rec.id)
        q.push(rec)
        pending.set(q)
        if (e.status === 401) { onLogout('The password has changed — log in again and this inspection will upload.'); return }
        toast('Saved on this device — it will upload when the connection is back')
        onSaved(rec, true)
      } else {
        toast("Couldn't save: " + e.message)
      }
    } finally { setSaving(false) }
  }

  const del = async () => {
    try {
      await api.deleteInspection(form.id, adminPw)
      toast('Inspection deleted')
      onDeleted(form.id)
    } catch (e) { toast("Couldn't delete: " + e.message) }
  }

  const areaOptions = form.area && !areas.includes(form.area) ? [...areas, form.area] : areas

  return (
    <section className="view">
      <div className="meta">
        <label className="f full">Area
          <select id="f-area" value={form.area} onChange={(e) => set({ area: e.target.value })}>
            <option value="" disabled>Choose an area…</option>
            {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="f">Date
          <input id="f-date" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label className="f">Inspected by
          <input id="f-by" type="text" value={form.inspector} placeholder="Ranger's name" autoComplete="name" onChange={(e) => set({ inspector: e.target.value })} />
        </label>
      </div>

      <div className="sheet">
        <div className="sheet-head">
          <h2>{form.area || 'Checks'}</h2>
          <div className="tally">
            <span className="pill p-none">{done}/{checks.length} done</span>
            {counts.act > 0 && <span className="pill p-act">{counts.act} action</span>}
            {counts.mon > 0 && <span className="pill p-mon">{counts.mon} monitor</span>}
          </div>
        </div>
        {checks.map((c) => {
          const it = form.items[c.id] || {}
          const showNote = it.status === 'act' || it.status === 'mon' || openNotes[c.id] || !!it.note
          return (
            <div key={c.id} className="row" data-s={it.status || ''}>
              <div className="row-top">
                <span className="name">{c.label}</span>
                <div className="seg" role="group" aria-label={c.label}>
                  {ORDER.map((v) => (
                    <button key={v} type="button" data-v={v} aria-pressed={it.status === v} title={ST[v].long}
                      onClick={() => setItem(c.id, { status: it.status === v ? '' : v })}>{ST[v].l}</button>
                  ))}
                </div>
              </div>
              {showNote
                ? <textarea id={'note-' + c.id} className="note" style={{ display: 'block' }} rows={2} value={it.note || ''}
                    placeholder={it.status === 'act' ? 'What needs doing, and where exactly?' : it.status === 'mon' ? 'What to keep an eye on?' : 'Specify location / detail'}
                    onChange={(e) => setItem(c.id, { note: e.target.value })} />
                : <button type="button" className="addnote" onClick={() => setOpenNotes((o) => ({ ...o, [c.id]: true }))}>+ Add detail</button>}
            </div>
          )
        })}
      </div>

      <label className="f">General comments
        <textarea id="f-comments" rows={3} value={form.comments} placeholder="Anything else the Clerk should know about this visit"
          onChange={(e) => set({ comments: e.target.value })} />
      </label>

      <div className="actions">
        <button className="btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : form.id ? 'Save changes' : 'Save inspection'}</button>
        <button className="btn ghost" onClick={() => { setForm(blankForm()); window.scrollTo({ top: 0 }) }}>Start new</button>
        {form.id && adminPw && <button className="btn danger" onClick={() => setConfirmDel(true)}>Delete</button>}
        {form.id && <span className="hint">Editing a saved inspection</span>}
      </div>
      {confirmDel && (
        <div className="confirm">
          Delete this inspection for good?
          <button className="btn danger small-btn" onClick={del}>Delete</button>
          <button className="btn ghost small-btn" onClick={() => setConfirmDel(false)}>Keep</button>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

function AdminPanel({ setup, setSetup, adminPw, setAdminPw, toast, online }) {
  const [pw, setPw] = useState('')
  const [newArea, setNewArea] = useState('')
  const [newCheck, setNewCheck] = useState('')
  const [pw1, setPw1] = useState('')
  const [rpw, setRpw] = useState('')
  const [busy, setBusy] = useState(false)

  const unlock = async () => {
    if (!pw) return
    setBusy(true)
    try { await api.checkPassword(pw); setAdminPw(pw); setPw(''); toast('Clerk tools unlocked') }
    catch (e) { toast(e.status === 401 ? 'Wrong password' : "Couldn't check password: " + e.message) }
    finally { setBusy(false) }
  }

  const push = async (next) => {
    setBusy(true)
    try { const saved = await api.saveSetup(next, adminPw); setSetup(saved); toast('Updated') }
    catch (e) {
      if (e.status === 401) { setAdminPw(''); toast('Password has changed — unlock again') }
      else toast("Couldn't save the change: " + e.message)
    } finally { setBusy(false) }
  }

  const changePw = async () => {
    if (pw1.length < 4) { toast('Use at least 4 characters'); return }
    setBusy(true)
    try { await api.changePassword(adminPw, pw1); setAdminPw(pw1); setPw1(''); toast('Password changed') }
    catch (e) { toast("Couldn't change password: " + e.message) }
    finally { setBusy(false) }
  }

  const changeRangerPw = async () => {
    if (rpw.length < 3) { toast('Use at least 3 characters'); return }
    setBusy(true)
    try { await api.changeRangerPassword(adminPw, rpw); setRpw(''); toast('Ranger password changed — tell the ranger the new one') }
    catch (e) { toast("Couldn't change password: " + e.message) }
    finally { setBusy(false) }
  }

  const label = { font: '600 13px var(--display)', letterSpacing: '.06em', textTransform: 'uppercase' }

  return (
    <div className="view" style={{ paddingTop: 0 }}>
      <details className="admin">
        <summary>Clerk tools</summary>
        {!adminPw ? (
          <div className="lock" style={{ marginTop: 10 }}>
            <p className="hint" style={{ margin: 0 }}>Enter the Clerk's password to manage areas and checks, or to delete inspections.</p>
            <div className="inline">
              <input id="admin-pw" type="password" value={pw} placeholder="Password" onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} />
              <button className="btn ghost small-btn" onClick={unlock} disabled={busy || !online}>Unlock</button>
            </div>
          </div>
        ) : (
          <>
            <p className="hint">Changes apply to everyone using the app. <button className="addnote" onClick={() => setAdminPw('')}>Lock</button></p>
            <strong style={label}>Areas</strong>
            <div className="chips">
              {setup.areas.map((a, i) => (
                <span className="chip" key={a}>{a}
                  <button aria-label={'Remove ' + a} disabled={busy || setup.areas.length <= 1}
                    onClick={() => push({ ...setup, areas: setup.areas.filter((_, j) => j !== i) })}>×</button>
                </span>
              ))}
            </div>
            <div className="inline">
              <input id="new-area" value={newArea} placeholder="Add an area" onChange={(e) => setNewArea(e.target.value)} />
              <button className="btn ghost small-btn" disabled={busy}
                onClick={() => { const v = newArea.trim(); if (!v || setup.areas.includes(v)) return; setNewArea(''); push({ ...setup, areas: [...setup.areas, v] }) }}>Add</button>
            </div>
            <div style={{ height: 14 }} />
            <strong style={label}>Checks</strong>
            <div className="chips">
              {setup.checks.map((c, i) => (
                <span className="chip" key={c.id}>{c.label}
                  <button aria-label={'Remove ' + c.label} disabled={busy || setup.checks.length <= 1}
                    onClick={() => push({ ...setup, checks: setup.checks.filter((_, j) => j !== i) })}>×</button>
                </span>
              ))}
            </div>
            <div className="inline">
              <input id="new-check" value={newCheck} placeholder="Add a check, e.g. Benches" onChange={(e) => setNewCheck(e.target.value)} />
              <button className="btn ghost small-btn" disabled={busy}
                onClick={() => { const v = newCheck.trim(); if (!v) return; setNewCheck(''); push({ ...setup, checks: [...setup.checks, { id: 'c' + Date.now().toString(36), label: v }] }) }}>Add</button>
            </div>
            <div style={{ height: 14 }} />
            <strong style={label}>Change ranger login password</strong>
            <div className="inline" style={{ marginTop: 8 }}>
              <input id="new-ranger-pw" type="text" value={rpw} placeholder="New ranger password" autoComplete="off" onChange={(e) => setRpw(e.target.value)} />
              <button className="btn ghost small-btn" disabled={busy} onClick={changeRangerPw}>Change</button>
            </div>
            <div style={{ height: 14 }} />
            <strong style={label}>Change Clerk password</strong>
            <div className="inline" style={{ marginTop: 8 }}>
              <input id="new-pw" type="password" value={pw1} placeholder="New password" onChange={(e) => setPw1(e.target.value)} />
              <button className="btn ghost small-btn" disabled={busy} onClick={changePw}>Change</button>
            </div>
          </>
        )}
      </details>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function HistoryView({ areas, list, onOpen }) {
  const [area, setArea] = useState('')
  const [show, setShow] = useState('all')
  const rows = list
    .filter((i) => (!area || i.area === area) && (show === 'all' || i.worst === 'act' || i.worst === 'mon'))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || '').localeCompare(a.updatedAt || ''))

  return (
    <section className="view">
      <div className="filters">
        <label className="f">Area
          <select id="h-area" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All areas</option>
            {areas.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="f">Show
          <select id="h-show" value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="all">All inspections</option>
            <option value="issues">Only with issues</option>
          </select>
        </label>
      </div>
      <div className="list">
        {!rows.length && <div className="empty">{list.length ? 'No inspections match these filters.' : 'No inspections saved yet. Completed inspections will appear here.'}</div>}
        {rows.map((i) => {
          const issues = Object.values(i.items || {}).filter((x) => x.status === 'act' || x.status === 'mon').sort((a, b) => ST[b.status].r - ST[a.status].r)
          const w = ST[i.worst] ? i.worst : 'ok'
          return (
            <button key={i.id} className="card" onClick={() => onOpen(i)}>
              <div className="card-top"><strong>{i.area}</strong><span className="date">{fmtDate(i.date)}</span></div>
              <div className="tally">
                <span className={'pill p-' + ST[w].c}>{ST[w].long}</span>
                {i._pending && <span className="pill p-none">Not yet uploaded</span>}
                {i.inspector && <span className="hint">by {i.inspector}</span>}
              </div>
              {issues.length > 0 && (
                <ul className="issues">
                  {issues.map((x, n) => <li key={n}><b style={{ color: `var(--${x.status})` }}>{ST[x.status].l}</b> · {x.label}{x.note ? ` — ${x.note}` : ''}</li>)}
                </ul>
              )}
              {i.comments && <div className="hint">{i.comments}</div>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function YearView({ areas, checks, list, onOpen }) {
  const years = useMemo(() => {
    const s = new Set([new Date().getFullYear()])
    list.forEach((i) => i.date && s.add(+i.date.slice(0, 4)))
    return [...s].sort((a, b) => b - a)
  }, [list])
  const [area, setArea] = useState(areas[0] || '')
  const [year, setYear] = useState(years[0])

  const months = useMemo(() => {
    const m = Array.from({ length: 12 }, () => ({ items: {}, recs: [], comments: [] }))
    list.filter((i) => i.area === area && i.date && i.date.startsWith(year + '-'))
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((i) => {
        const mm = +i.date.slice(5, 7) - 1
        m[mm].recs.push(i)
        if (i.comments) m[mm].comments.push(i.comments)
        for (const k in i.items || {}) {
          const s = i.items[k].status, cur = m[mm].items[k]
          if (ST[s] && (!cur || ST[s].r > ST[cur.status].r)) m[mm].items[k] = { status: s, note: i.items[k].note }
        }
      })
    return m
  }, [list, area, year])

  const now = new Date()
  const curM = now.getFullYear() === +year ? now.getMonth() : -1

  const exportCsv = () => {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const lines = [[year], ['Area: ' + area], ['Risk', ...MONTHS, 'Comments']]
    checks.forEach((c) => {
      const notes = months.map((mo, i) => mo.items[c.id]?.note ? `${MONTHS[i]}: ${mo.items[c.id].note}` : '').filter(Boolean).join('; ')
      lines.push([c.label, ...months.map((mo) => mo.items[c.id] ? ST[mo.items[c.id].status].long : ''), notes])
    })
    lines.push(['General comments', ...months.map((mo) => mo.comments.join(' / ')), ''])
    const csv = lines.map((r) => r.map(q).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${area.replace(/[^\w]+/g, '-')}-${year}-inspections.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="view">
      <div className="filters">
        <label className="f">Area
          <select id="y-area" value={area} onChange={(e) => setArea(e.target.value)}>
            {areas.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="f">Year
          <select id="y-year" value={year} onChange={(e) => setYear(+e.target.value)}>
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <div className="legend">
        {['ok', 'mon', 'act', 'na'].map((s) => <span key={s}><i className={'cell c-' + s}>{ST[s].g}</i> {ST[s].long}</span>)}
      </div>
      <div className="gridwrap">
        <table className="yr">
          <thead><tr><th>Check</th>{MONTHS.map((x, i) => <th key={x} className={i === curM ? 'cur' : ''}>{x}</th>)}</tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                {months.map((mo, i) => {
                  const it = mo.items[c.id]
                  return (
                    <td key={i} className={i === curM ? 'cur' : ''}>
                      {it && <button className={'cell c-' + ST[it.status].c} style={{ border: 0, cursor: 'pointer' }}
                        title={ST[it.status].long + (it.note ? ': ' + it.note : '')}
                        onClick={() => onOpen(mo.recs[mo.recs.length - 1])}>{ST[it.status].g}</button>}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr>
              <td className="hint">Inspections</td>
              {months.map((mo, i) => <td key={i} className={'hint' + (i === curM ? ' cur' : '')} style={{ fontFamily: 'var(--mono)' }}>{mo.recs.length || ''}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button className="btn ghost" onClick={exportCsv}>Download CSV</button>
        <span className="hint">Worst result in each month is shown. Tap a mark to open that month's latest inspection.</span>
      </div>
    </section>
  )
}
