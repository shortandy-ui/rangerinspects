// Small client for the Azure Functions API (served at /api on the same site).

// The ranger's login is remembered on the device so it works out in the field.
const LOGIN_KEY = 'ranger-login'
export const login = {
  get() { try { return localStorage.getItem(LOGIN_KEY) || '' } catch { return '' } },
  set(pw) { try { pw ? localStorage.setItem(LOGIN_KEY, pw) : localStorage.removeItem(LOGIN_KEY) } catch {} }
}

async function call(method, path, body, password, rangerPassword) {
  const headers = { 'Content-Type': 'application/json' }
  if (password) headers['x-admin-password'] = password
  const rp = rangerPassword ?? login.get()
  if (rp) headers['x-ranger-password'] = rp
  let res
  try {
    res = await fetch('/api/' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (e) {
    const err = new Error('No internet connection')
    err.offline = true
    throw err
  }
  let data = null
  const text = await res.text()
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Server error ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  load: (rangerPassword) => call('GET', 'data', undefined, undefined, rangerPassword),
  saveInspection: (rec) => call('POST', 'inspections', rec),
  deleteInspection: (id, pw) => call('DELETE', 'inspections/' + encodeURIComponent(id), undefined, pw),
  saveSetup: (setup, pw) => call('PUT', 'setup', setup, pw),
  checkPassword: (pw) => call('POST', 'manage/login', {}, pw),
  changePassword: (pw, newPassword) => call('POST', 'manage/password', { newPassword }, pw),
  changeRangerPassword: (pw, newPassword) => call('POST', 'manage/ranger-password', { newPassword }, pw)
}

// Inspections saved while offline wait here until they can be uploaded.
const KEY = 'ranger-pending'
export const pending = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } },
  set(list) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }
}

export function ls(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key)
    localStorage.setItem(key, value)
  } catch { return null }
}
