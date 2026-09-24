// All app data lives in one JSON file in Azure Blob Storage:
//   container "datchworth-ranger-data", blob "data.json"
// Writes use the blob's ETag so two people saving at the same moment
// can't overwrite each other — the second save simply retries.
const crypto = require('crypto')
const { BlobServiceClient } = require('@azure/storage-blob')

const CONTAINER = 'datchworth-ranger-data'
const BLOB = 'data.json'
const DEFAULT_PASSWORD = 'ranger'        // Clerk (admin) starting password
const DEFAULT_RANGER_PASSWORD = 'dpc'    // Ranger login starting password

const { defaultSetup } = require('./checklists')

class ConfigError extends Error {}

let containerClient = null
async function container() {
  if (containerClient) return containerClient
  const conn = process.env.STORAGE_CONNECTION_STRING
  if (!conn) throw new ConfigError('STORAGE_CONNECTION_STRING is not set in the Static Web App configuration')
  const svc = BlobServiceClient.fromConnectionString(conn)
  const c = svc.getContainerClient(CONTAINER)
  await c.createIfNotExists()
  containerClient = c
  return c
}

function hash(pw, salt) {
  return crypto.createHash('sha256').update(salt + ':' + pw).digest('hex')
}

function makeSecret(pw) {
  const salt = crypto.randomBytes(8).toString('hex')
  return { salt, hash: hash(pw, salt) }
}

function freshData() {
  return {
    setup: defaultSetup(),
    inspections: [],
    admin: makeSecret(DEFAULT_PASSWORD),
    ranger: makeSecret(DEFAULT_RANGER_PASSWORD)
  }
}

async function read() {
  const c = await container()
  const blob = c.getBlockBlobClient(BLOB)
  try {
    const buf = await blob.downloadToBuffer()
    const props = await blob.getProperties()
    const data = JSON.parse(buf.toString('utf8'))
    // Version 1 had one generic checklist; move to per-area checklists.
    if (!data.setup || data.setup.version !== 2) data.setup = defaultSetup()
    return { data, etag: props.etag }
  } catch (e) {
    if (e.statusCode === 404) return { data: freshData(), etag: null }
    throw e
  }
}

// Read, apply `change(data)`, write back — retrying if someone else wrote in between.
async function update(change) {
  const c = await container()
  const blob = c.getBlockBlobClient(BLOB)
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, etag } = await read()
    const result = await change(data)
    const body = JSON.stringify(data)
    try {
      await blob.upload(body, Buffer.byteLength(body), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' }
      })
      return result
    } catch (e) {
      if (e.statusCode === 412 || e.statusCode === 409) {
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 300))
        continue
      }
      throw e
    }
  }
  throw new Error('The records are busy — please try again')
}

function matches(secret, pw) {
  return !!(pw && secret && hash(pw, secret.salt) === secret.hash)
}

// Clerk (admin) password
function passwordOk(data, pw) {
  return matches(data.admin, pw)
}

// Ranger login — the Clerk's password is accepted too.
function rangerOk(data, pw) {
  if (!pw) return false
  if (matches(data.admin, pw)) return true
  if (!data.ranger) return pw === DEFAULT_RANGER_PASSWORD
  return matches(data.ranger, pw)
}

module.exports = { read, update, passwordOk, rangerOk, makeSecret, hash, ConfigError }
