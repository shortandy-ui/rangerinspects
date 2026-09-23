const { app } = require('@azure/functions')
const store = require('../store')
const { json, handle, fail, body } = require('../http')

// Note: routes must not start with "admin" — Azure Functions reserves that word.

// POST /api/manage/login — check the Clerk password.
app.http('manageLogin', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'manage/login',
  handler: handle(async (request) => {
    const { data } = await store.read()
    if (!store.passwordOk(data, request.headers.get('x-admin-password'))) throw fail(401, 'Wrong password')
    return json(200, { ok: true })
  })
})

// POST /api/manage/password — change the Clerk password.
app.http('managePassword', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'manage/password',
  handler: handle(async (request) => {
    const pw = request.headers.get('x-admin-password')
    const { newPassword } = await body(request)
    if (!newPassword || String(newPassword).length < 4) throw fail(400, 'Use at least 4 characters')
    await store.update((data) => {
      if (!store.passwordOk(data, pw)) throw fail(401, 'Wrong password')
      data.admin = store.makeSecret(String(newPassword))
    })
    return json(200, { ok: true })
  })
})

// POST /api/manage/ranger-password — Clerk sets the ranger's login password.
app.http('manageRangerPassword', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'manage/ranger-password',
  handler: handle(async (request) => {
    const pw = request.headers.get('x-admin-password')
    const { newPassword } = await body(request)
    if (!newPassword || String(newPassword).length < 3) throw fail(400, 'Use at least 3 characters')
    await store.update((data) => {
      if (!store.passwordOk(data, pw)) throw fail(401, 'Wrong password')
      data.ranger = store.makeSecret(String(newPassword))
    })
    return json(200, { ok: true })
  })
})

// PUT /api/setup — update the list of areas and checks.
app.http('saveSetup', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'setup',
  handler: handle(async (request) => {
    const pw = request.headers.get('x-admin-password')
    const input = await body(request)
    const areas = [...new Set((input.areas || []).map((a) => String(a).trim().slice(0, 120)).filter(Boolean))]
    const checks = (input.checks || [])
      .filter((c) => c && c.id && c.label)
      .map((c) => ({ id: String(c.id).slice(0, 60), label: String(c.label).trim().slice(0, 200) }))
    if (!areas.length) throw fail(400, 'Keep at least one area')
    if (!checks.length) throw fail(400, 'Keep at least one check')
    const setup = { areas, checks }
    await store.update((data) => {
      if (!store.passwordOk(data, pw)) throw fail(401, 'Wrong password')
      data.setup = setup
    })
    return json(200, setup)
  })
})
