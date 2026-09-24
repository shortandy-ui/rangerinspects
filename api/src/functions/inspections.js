const { app } = require('@azure/functions')
const store = require('../store')
const { json, handle, fail, body } = require('../http')

const STATUSES = ['ok', 'mon', 'act', 'na']
const clip = (s, n) => String(s ?? '').slice(0, n)

function clean(input) {
  if (!input.id || !/^[\w-]{1,80}$/.test(input.id)) throw fail(400, 'Missing inspection id')
  if (!input.area) throw fail(400, 'Choose an area')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw fail(400, 'Add a valid date')
  const items = {}
  for (const [k, v] of Object.entries(input.items || {})) {
    if (!v || !STATUSES.includes(v.status)) continue
    items[clip(k, 90)] = { status: v.status, note: clip(v.note, 1000), label: clip(v.label, 200), section: clip(v.section, 120) }
  }
  if (!Object.keys(items).length) throw fail(400, 'Mark at least one check')
  const rank = { na: 0, ok: 1, mon: 2, act: 3 }
  let worst = ''
  for (const v of Object.values(items)) if (!worst || rank[v.status] > rank[worst]) worst = v.status
  const now = new Date().toISOString()
  return {
    id: input.id,
    area: clip(input.area, 120),
    areaId: clip(input.areaId, 90),
    date: input.date,
    inspector: clip(input.inspector, 120),
    items,
    comments: clip(input.comments, 3000),
    worst,
    createdAt: clip(input.createdAt, 40) || now,
    updatedAt: now
  }
}

// POST /api/inspections — create or update (same id = update).
app.http('saveInspection', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'inspections',
  handler: handle(async (request) => {
    const rec = clean(await body(request))
    const pw = request.headers.get('x-ranger-password')
    await store.update((data) => {
      if (!store.rangerOk(data, pw)) throw fail(401, 'Please log in')
      const i = data.inspections.findIndex((x) => x.id === rec.id)
      if (i >= 0) { rec.createdAt = data.inspections[i].createdAt || rec.createdAt; data.inspections[i] = rec }
      else data.inspections.push(rec)
    })
    return json(200, rec)
  })
})

// DELETE /api/inspections/{id} — Clerk password required.
app.http('deleteInspection', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'inspections/{id}',
  handler: handle(async (request) => {
    const id = request.params.id
    const pw = request.headers.get('x-admin-password')
    await store.update((data) => {
      if (!store.passwordOk(data, pw)) throw fail(401, 'Wrong password')
      data.inspections = data.inspections.filter((x) => x.id !== id)
    })
    return json(200, { ok: true })
  })
})
