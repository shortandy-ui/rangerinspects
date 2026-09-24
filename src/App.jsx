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
const blankForm = (areaId = '') => ({ id: null, areaId, date: today(), inspector: ls('ranger-name') || '', items: {}, comments: '' })

const cachedSetup = () => { try { const s = JSON.parse(ls('ranger-setup') || 'null'); return s && s.version === 2 ? s : null } catch { return null } }

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

  const allInspections = useMemo(() => {
    const ids = new Set(inspections.map((i) => i.id))
    return [...inspections, ...queued.filter((q) => !ids.has(q.id)).map((q) => ({ ...q, _pending: true }))]
  }, [inspections, queued])

  const openInspection = (rec) => {
    const a = findArea(areas, rec)
    setForm({
      id: rec.id, areaId: a ? a.id : '', areaName: rec.area, date: rec.date, inspector: rec.inspector || '',
      comments: rec.comments || '', items: JSON.parse(JSON.stringify(rec.items || {})), createdAt: rec.createdAt
    })
    go('inspect')
    window.scrollTo({ top: 0 })
  }

  const setAdmin = (pw) => { setAdminPw(pw); try { pw ? sessionStorage.setItem('ranger-admin', pw) : sessionStorage.removeItem('ranger-admin') } catch {} }

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
      {status === 'offline' && !setup && (
        <section className="view"><div className="empty">This device hasn't loaded the checklists yet. Open the app once with a signal and it will then work offline.</div></section>
      )}

      {setup && tab === 'inspect' && (
        <InspectView
          setup={setup} form={form} setForm={setForm} toast={toast}
          online={status === 'online'} adminPw={adminPw} onLogout={onLogout}
          onSaved={(rec, wasQueued) => {
            if (wasQueued) setQueued(pending.get())
            else setInspections((list) => [rec, ...list.filter((i) => i.id !== rec.id)])
            setForm(blankForm(rec.areaId))
            window.scrollTo({ top: 0 })
          }}
          onDeleted={(id) => { setInspections((l) => l.filter((i) => i.id !== id)); setForm(blankForm()) }}
        />
      )}
      {setup && tab === 'inspect' && (
        <AdminPanel setup={setup} setSetup={(s) => { setSetup(s); ls('ranger-setup', JSON.stringify(s)) }}
          adminPw={adminPw} setAdminPw={setAdmin} toast={toast} online={status === 'online'} />
      )}
      {setup && tab === 'history' && <HistoryView areas={areas} list={allInspections} onOpen={openInspection} />}
      {setup && tab === 'year' && <YearView setup={setup} list={allInspections} onOpen={openInspection} />}

      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  )
}

/* ---------- checklist helpers ---------- */

// A saved inspection belongs to an area by id (new records) or by name (older ones).
function findArea(areas, rec) {
  return areas.find((a) => a.id === rec.areaId) || areas.find((a) => a.name === rec.area) || null
}
function sectionsFor(setup, area) {
  if (!area) return []
  const common = { id: 'common', title: setup.commonTitle || 'Green Areas & Common Land', common: true, items: setup.common || [] }
  return [common, ...area.sections].filter((s) => s.items.length)
}
const recordMatchesArea = (rec, area) => rec.areaId ? rec.areaId === area.id : rec.area === area.name

/* ------------------------------------------------------------------ */

function InspectView({ setup, form, setForm, toast, online, adminPw, onLogout, onSaved, onDeleted }) {
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [openNotes, setOpenNotes] = useState({})
  useEffect(() => { setConfirmDel(false); setOpenNotes({}) }, [form.id])

  const area = setup.areas.find((a) => a.id === form.areaId) || null
  const sections = sectionsFor(setup, area)
  const allItems = sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })))

  // Items on an older saved inspection that are no longer on the checklist.
  const known = new Set(allItems.map((i) => i.id))
  const retired = Object.entries(form.items || {}).filter(([k, v]) => !known.has(k) && v && v.status)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setItem = (id, patch) => setForm((f) => ({ ...f, items: { ...f.items, [id]: { ...(f.items[id] || {}), ...patch } } }))

  // "Everything in order" ticks: mark a whole section (or the whole area) OK and fold the list away.
  const [opened, setOpened] = useState({})
  useEffect(() => { setOpened({}) }, [form.id, form.areaId])
  const setAllOk = (list, on) => setForm((f) => {
    const items = { ...f.items }
    list.forEach((i) => {
      if (on) items[i.id] = { ...(items[i.id] || {}), status: 'ok' }
      else if (items[i.id]?.status === 'ok') items[i.id] = { ...items[i.id], status: '' }
    })
    return { ...f, items }
  })
  const isAllOk = (list) => list.length > 0 && list.every((i) => form.items[i.id]?.status === 'ok')

  const counts = { ok: 0, mon: 0, act: 0, na: 0 }
  let done = 0
  allItems.forEach((c) => { const s = form.items[c.id]?.status; if (s) { counts[s]++; done++ } })

  const save = async () => {
    if (!area) { toast('Choose an area first'); return }
    if (!form.date) { toast('Add the inspection date'); return }
    const marked = allItems.filter((c) => form.items[c.id]?.status)
    if (!marked.length && !retired.length) { toast('Mark at least one item before saving'); return }
    const items = {}
    marked.forEach((c) => { const it = form.items[c.id]; items[c.id] = { status: it.status, note: (it.note || '').trim(), label: c.label, section: c.section } })
    retired.forEach(([k, v]) => { items[k] = v })
    const now = new Date().toISOString()
    const rec = {
      id: form.id || newId(), areaId: area.id, area: area.name, date: form.date, inspector: (form.inspector || '').trim(),
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

  const row = (c, it) => {
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
  }

  return (
    <section className="view">
      <div className="meta">
        <label className="f full">Area
          <select id="f-area" value={area ? area.id : ''} onChange={(e) => set({ areaId: e.target.value })}>
            <option value="" disabled>Choose an area…</option>
            {setup.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="f">Date
          <input id="f-date" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label className="f">Inspected by
          <input id="f-by" type="text" value={form.inspector} placeholder="Ranger's name" autoComplete="name" onChange={(e) => set({ inspector: e.target.value })} />
        </label>
      </div>

      {form.id && !area && form.areaName && (
        <div className="banner">This inspection is for “{form.areaName}”, which is no longer in the list of areas. Choose an area to re-save it.</div>
      )}

      {area && (
        <label className={'inorder whole' + (isAllOk(allItems) ? ' on' : '')}>
          <input id="area-in-order" type="checkbox" checked={isAllOk(allItems)} onChange={(e) => setAllOk(allItems, e.target.checked)} />
          <span><b>Whole area in order</b><small>Ticks all {allItems.length} items at {area.name} as OK</small></span>
        </label>
      )}

      {area && (
        <div className="progress">
          <span className="pill p-none">{done}/{allItems.length} checked</span>
          {counts.act > 0 && <span className="pill p-act">{counts.act} action</span>}
          {counts.mon > 0 && <span className="pill p-mon">{counts.mon} monitor</span>}
        </div>
      )}

      {sections.map((sec) => {
        const secDone = sec.items.filter((i) => form.items[i.id]?.status).length
        const allInOrder = isAllOk(sec.items)
        const folded = allInOrder && !opened[sec.id]
        return (
          <div className="sheet" key={sec.id}>
            <div className="sheet-head">
              <h2>{sec.title}{sec.common && <span className="sub">every area</span>}</h2>
              <div className="tally">
                <span className="pill p-none">{secDone}/{sec.items.length}</span>
              </div>
            </div>
            <label className={'inorder' + (allInOrder ? ' on' : '')}>
              <input id={'in-order-' + sec.id} type="checkbox" checked={allInOrder} onChange={(e) => setAllOk(sec.items, e.target.checked)} />
              <span><b>Everything in order</b><small>Ticks {sec.items.length === 1 ? 'this item' : 'all ' + sec.items.length + ' items'} as OK</small></span>
            </label>
            {folded
              ? <button type="button" className="addnote folded" onClick={() => setOpened((o) => ({ ...o, [sec.id]: true }))}>Show {sec.items.length === 1 ? 'the item' : 'the ' + sec.items.length + ' items'}</button>
              : sec.items.map((c) => row(c, form.items[c.id] || {}))}
          </div>
        )
      })}

      {retired.length > 0 && (
        <div className="sheet">
          <div className="sheet-head"><h2>No longer on the checklist</h2></div>
          {retired.map(([k, v]) => (
            <div key={k} className="row" data-s={v.status}>
              <div className="row-top"><span className="name">{v.label || k}</span><span className={'pill p-' + ST[v.status].c}>{ST[v.status].long}</span></div>
              {v.note && <div className="hint">{v.note}</div>}
            </div>
          ))}
        </div>
      )}

      {area && (
        <label className="f">General comments
          <textarea id="f-comments" rows={3} value={form.comments} placeholder="Anything else the Clerk should know about this visit"
            onChange={(e) => set({ comments: e.target.value })} />
        </label>
      )}

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

  return (
    <div className="view" style={{ paddingTop: 0 }}>
      <details className="admin" id="clerk-tools">
        <summary>Clerk tools</summary>
        {!adminPw ? (
          <div className="lock" style={{ marginTop: 10 }}>
            <p className="hint" style={{ margin: 0 }}>Enter the Clerk's password to edit checklists, delete inspections or change passwords.</p>
            <div className="inline">
              <input id="admin-pw" type="password" value={pw} placeholder="Password" onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} />
              <button className="btn ghost small-btn" onClick={unlock} disabled={busy || !online}>Unlock</button>
            </div>
          </div>
        ) : (
          <>
            <p className="hint">Unlocked. <button className="addnote" onClick={() => setAdminPw('')}>Lock</button></p>
            <ChecklistEditor setup={setup} setSetup={setSetup} adminPw={adminPw} setAdminPw={setAdminPw} toast={toast} online={online} />
            <div className="subhead">Passwords</div>
            <label className="f">Ranger login password
              <div className="inline">
                <input id="new-ranger-pw" type="text" value={rpw} placeholder="New ranger password" autoComplete="off" onChange={(e) => setRpw(e.target.value)} />
                <button className="btn ghost small-btn" disabled={busy} onClick={changeRangerPw}>Change</button>
              </div>
            </label>
            <label className="f" style={{ marginTop: 10 }}>Clerk password
              <div className="inline">
                <input id="new-pw" type="password" value={pw1} placeholder="New Clerk password" onChange={(e) => setPw1(e.target.value)} />
                <button className="btn ghost small-btn" disabled={busy} onClick={changePw}>Change</button>
              </div>
            </label>
          </>
        )}
      </details>
    </div>
  )
}

/* ---------- checklist editor (Clerk) ---------- */

const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const move = (arr, i, d) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a }

function ItemList({ items, onChange, addLabel }) {
  const [text, setText] = useState('')
  const add = () => { const v = text.trim(); if (!v) return; onChange([...items, { id: uid('i'), label: v }]); setText('') }
  return (
    <div className="ed-items">
      {items.map((it, i) => (
        <div className="ed-item" key={it.id}>
          <input aria-label="Item name" value={it.label} onChange={(e) => onChange(items.map((x) => x.id === it.id ? { ...x, label: e.target.value } : x))} />
          <button className="icon" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => onChange(move(items, i, -1))}>↑</button>
          <button className="icon" title="Move down" aria-label="Move down" disabled={i === items.length - 1} onClick={() => onChange(move(items, i, 1))}>↓</button>
          <button className="icon del" title="Remove" aria-label={'Remove ' + it.label} onClick={() => onChange(items.filter((x) => x.id !== it.id))}>×</button>
        </div>
      ))}
      <div className="inline">
        <input value={text} placeholder={addLabel} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn ghost small-btn" onClick={add}>Add</button>
      </div>
    </div>
  )
}

function ChecklistEditor({ setup, setSetup, adminPw, setAdminPw, toast, online }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(setup)))
  const [sel, setSel] = useState(() => setup.areas[0]?.id || 'common')
  const [newArea, setNewArea] = useState('')
  const [newSection, setNewSection] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(setup)

  // Pick up changes saved from another device when nothing is being edited here.
  useEffect(() => { if (!dirty) setDraft(JSON.parse(JSON.stringify(setup))) }, [setup]) // eslint-disable-line

  const area = draft.areas.find((a) => a.id === sel)
  const setArea = (patch) => setDraft((d) => ({ ...d, areas: d.areas.map((a) => a.id === sel ? { ...a, ...patch } : a) }))
  const setSections = (fn) => setArea({ sections: fn(area.sections) })

  const save = async () => {
    const names = draft.areas.map((a) => a.name.trim().toLowerCase())
    if (names.some((n) => !n)) { toast('Every area needs a name'); return }
    if (new Set(names).size !== names.length) { toast('Two areas have the same name'); return }
    setBusy(true)
    try { const saved = await api.saveSetup(draft, adminPw); setSetup(saved); setDraft(JSON.parse(JSON.stringify(saved))); toast('Checklists saved') }
    catch (e) {
      if (e.status === 401) { setAdminPw(''); toast('Password has changed — unlock again') }
      else toast("Couldn't save: " + e.message)
    } finally { setBusy(false) }
  }

  const addArea = () => {
    const v = newArea.trim(); if (!v) return
    if (draft.areas.some((a) => a.name.toLowerCase() === v.toLowerCase())) { toast('There is already an area called ' + v); return }
    const a = { id: uid('a'), name: v, sections: [] }
    setDraft((d) => ({ ...d, areas: [...d.areas, a] })); setSel(a.id); setNewArea('')
  }
  const removeArea = () => {
    setDraft((d) => ({ ...d, areas: d.areas.filter((a) => a.id !== sel) }))
    setSel(draft.areas.find((a) => a.id !== sel)?.id || 'common'); setConfirm('')
  }
  const addSection = () => {
    const v = newSection.trim(); if (!v) return
    setSections((ss) => [...ss, { id: uid('s'), title: v, items: [] }]); setNewSection('')
  }

  return (
    <div className="editor">
      <div className="subhead">Checklists</div>
      <label className="f">Edit checklist for
        <select id="ed-area" value={sel} onChange={(e) => { setSel(e.target.value); setConfirm('') }}>
          <option value="common">{draft.commonTitle} (every area)</option>
          {draft.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>

      {sel === 'common' && (
        <div className="ed-section">
          <p className="hint" style={{ margin: 0 }}>These checks appear at the top of every area's inspection.</p>
          <ItemList items={draft.common} addLabel="Add a check, e.g. Trees & hedges" onChange={(items) => setDraft((d) => ({ ...d, common: items }))} />
        </div>
      )}

      {area && (
        <>
          <label className="f">Area name
            <input id="ed-area-name" value={area.name} onChange={(e) => setArea({ name: e.target.value })} />
          </label>
          {area.sections.length === 0 && <p className="hint">No equipment listed yet. This area only has the common checks. Add a section below (e.g. Benches, Litter bins).</p>}
          {area.sections.map((s, si) => (
            <div className="ed-section" key={s.id}>
              <div className="ed-sec-head">
                <input className="ed-sec-title" aria-label="Section name" value={s.title}
                  onChange={(e) => setSections((ss) => ss.map((x) => x.id === s.id ? { ...x, title: e.target.value } : x))} />
                <button className="icon" title="Move section up" aria-label="Move section up" disabled={si === 0} onClick={() => setSections((ss) => move(ss, si, -1))}>↑</button>
                <button className="icon" title="Move section down" aria-label="Move section down" disabled={si === area.sections.length - 1} onClick={() => setSections((ss) => move(ss, si, 1))}>↓</button>
                <button className="icon del" title="Remove section" aria-label={'Remove section ' + s.title} onClick={() => setConfirm('sec:' + s.id)}>×</button>
              </div>
              {confirm === 'sec:' + s.id && (
                <div className="confirm">Remove “{s.title}” and its {s.items.length} item{s.items.length === 1 ? '' : 's'}?
                  <button className="btn danger small-btn" onClick={() => { setSections((ss) => ss.filter((x) => x.id !== s.id)); setConfirm('') }}>Remove</button>
                  <button className="btn ghost small-btn" onClick={() => setConfirm('')}>Keep</button>
                </div>
              )}
              <ItemList items={s.items} addLabel={'Add to ' + s.title + ', e.g. Bin 4 (by the gate)'}
                onChange={(items) => setSections((ss) => ss.map((x) => x.id === s.id ? { ...x, items } : x))} />
            </div>
          ))}
          <div className="inline">
            <input id="ed-new-section" value={newSection} placeholder="Add a section, e.g. Dog bins" onChange={(e) => setNewSection(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSection()} />
            <button className="btn ghost small-btn" onClick={addSection}>Add section</button>
          </div>
          {confirm === 'area'
            ? <div className="confirm">Remove the area “{area.name}”? Past inspections are kept.
                <button className="btn danger small-btn" onClick={removeArea} disabled={draft.areas.length <= 1}>Remove area</button>
                <button className="btn ghost small-btn" onClick={() => setConfirm('')}>Keep</button>
              </div>
            : <button className="addnote danger-link" onClick={() => setConfirm('area')}>Remove this area…</button>}
        </>
      )}

      <div className="inline" style={{ marginTop: 6 }}>
        <input id="ed-new-area" value={newArea} placeholder="Add a new area" onChange={(e) => setNewArea(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addArea()} />
        <button className="btn ghost small-btn" onClick={addArea}>Add area</button>
      </div>

      <div className={'savebar' + (dirty ? ' on' : '')}>
        <span>{dirty ? 'Unsaved checklist changes' : 'All checklist changes saved'}</span>
        <div className="actions">
          <button className="btn ghost small-btn" disabled={!dirty || busy} onClick={() => { setDraft(JSON.parse(JSON.stringify(setup))); if (!setup.areas.some((a) => a.id === sel) && sel !== 'common') setSel(setup.areas[0]?.id || 'common') }}>Discard</button>
          <button className="btn small-btn" id="ed-save" disabled={!dirty || busy || !online} onClick={save}>{busy ? 'Saving…' : 'Save checklists'}</button>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Removing an item doesn't affect past inspections. They still show it on the Year sheet.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function HistoryView({ areas, list, onOpen }) {
  const [areaId, setAreaId] = useState('')
  const [show, setShow] = useState('all')
  const area = areas.find((a) => a.id === areaId)
  const rows = list
    .filter((i) => (!area || recordMatchesArea(i, area)) && (show === 'all' || i.worst === 'act' || i.worst === 'mon'))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || '').localeCompare(a.updatedAt || ''))

  return (
    <section className="view">
      <div className="filters">
        <label className="f">Area
          <select id="h-area" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">All areas</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
          const n = Object.keys(i.items || {}).length
          return (
            <button key={i.id} className="card" onClick={() => onOpen(i)}>
              <div className="card-top"><strong>{i.area}</strong><span className="date">{fmtDate(i.date)}</span></div>
              <div className="tally">
                <span className={'pill p-' + ST[w].c}>{ST[w].long}</span>
                <span className="pill p-none">{n} item{n === 1 ? '' : 's'} checked</span>
                {i._pending && <span className="pill p-none">Not yet uploaded</span>}
                {i.inspector && <span className="hint">by {i.inspector}</span>}
              </div>
              {issues.length > 0 && (
                <ul className="issues">
                  {issues.map((x, k) => <li key={k}><b style={{ color: `var(--${x.status})` }}>{ST[x.status].l}</b> · {x.label}{x.note ? ` — ${x.note}` : ''}</li>)}
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

function YearView({ setup, list, onOpen }) {
  const areas = setup.areas
  const years = useMemo(() => {
    const s = new Set([new Date().getFullYear()])
    list.forEach((i) => i.date && s.add(+i.date.slice(0, 4)))
    return [...s].sort((a, b) => b - a)
  }, [list])
  const [areaId, setAreaId] = useState(areas[0]?.id || '')
  const [year, setYear] = useState(years[0])
  const area = areas.find((a) => a.id === areaId) || areas[0]

  const { months, extra } = useMemo(() => {
    const m = Array.from({ length: 12 }, () => ({ items: {}, recs: [], comments: [] }))
    const seen = {}
    if (area) {
      list.filter((i) => recordMatchesArea(i, area) && i.date && i.date.startsWith(year + '-'))
        .sort((a, b) => a.date.localeCompare(b.date))
        .forEach((i) => {
          const mm = +i.date.slice(5, 7) - 1
          m[mm].recs.push(i)
          if (i.comments) m[mm].comments.push(i.comments)
          for (const k in i.items || {}) {
            const it = i.items[k], cur = m[mm].items[k]
            seen[k] = it.label || k
            if (ST[it.status] && (!cur || ST[it.status].r > ST[cur.status].r)) m[mm].items[k] = { status: it.status, note: it.note }
          }
        })
    }
    return { months: m, extra: seen }
  }, [list, area, year])

  const sections = sectionsFor(setup, area)
  const known = new Set(sections.flatMap((s) => s.items.map((i) => i.id)))
  const retired = Object.entries(extra).filter(([k]) => !known.has(k)).map(([id, label]) => ({ id, label }))
  const groups = retired.length ? [...sections, { id: 'retired', title: 'No longer on the checklist', items: retired }] : sections

  const now = new Date()
  const curM = now.getFullYear() === +year ? now.getMonth() : -1

  const exportCsv = () => {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const lines = [[year], ['Area: ' + area.name], ['Item', ...MONTHS, 'Comments']]
    groups.forEach((g) => {
      lines.push([g.title.toUpperCase()])
      g.items.forEach((c) => {
        const notes = months.map((mo, i) => mo.items[c.id]?.note ? `${MONTHS[i]}: ${mo.items[c.id].note}` : '').filter(Boolean).join('; ')
        lines.push([c.label, ...months.map((mo) => mo.items[c.id] ? ST[mo.items[c.id].status].long : ''), notes])
      })
    })
    lines.push(['General comments', ...months.map((mo) => mo.comments.join(' / ')), ''])
    const csv = lines.map((r) => r.map(q).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${area.name.replace(/[^\w]+/g, '-')}-${year}-inspections.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (!area) return <section className="view"><div className="empty">No areas set up yet.</div></section>

  return (
    <section className="view">
      <div className="filters">
        <label className="f">Area
          <select id="y-area" value={area.id} onChange={(e) => setAreaId(e.target.value)}>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
          <thead><tr><th>Item</th>{MONTHS.map((x, i) => <th key={x} className={i === curM ? 'cur' : ''}>{x}</th>)}</tr></thead>
          <tbody>
            {groups.map((g) => (
              <React.Fragment key={g.id}>
                <tr className="grp"><td colSpan={13}>{g.title}</td></tr>
                {g.items.map((c) => (
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
              </React.Fragment>
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
