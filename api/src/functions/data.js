const { app } = require('@azure/functions')
const store = require('../store')
const { json, handle, fail } = require('../http')

// GET /api/data — everything the app needs to show.
app.http('data', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'data',
  handler: handle(async (request) => {
    const { data } = await store.read()
    if (!store.rangerOk(data, request.headers.get('x-ranger-password'))) throw fail(401, 'Please log in')
    return json(200, { setup: data.setup, inspections: data.inspections })
  })
})

// GET /api/health — quick check that the API and storage are wired up.
app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: handle(async () => {
    const { data } = await store.read()
    return json(200, { ok: true, storage: 'connected', inspections: data.inspections.length })
  })
})
