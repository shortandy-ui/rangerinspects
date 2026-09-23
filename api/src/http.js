const { ConfigError } = require('./store')

const json = (status, body) => ({ status, jsonBody: body })

// Wrap a handler so every failure returns a readable JSON error.
function handle(fn) {
  return async (request, context) => {
    try {
      return await fn(request, context)
    } catch (e) {
      context.error(e)
      if (e instanceof ConfigError) return json(500, { error: e.message })
      if (e.status) return json(e.status, { error: e.message })
      return json(500, { error: 'Storage error: ' + (e.message || 'unknown') })
    }
  }
}

function fail(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

async function body(request) {
  try { return (await request.json()) || {} } catch { return {} }
}

module.exports = { json, handle, fail, body }
