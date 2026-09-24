// Default checklists, taken from the council's Word inspection reports.
// The Clerk can change all of this in the app (Clerk tools → Checklists);
// these defaults are only used the first time the app runs.

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

function area(id, name, sections) {
  const used = new Set()
  return {
    id,
    name,
    sections: sections.map(([title, items]) => ({
      id: id + '--' + slug(title),
      title,
      items: items.map((label) => {
        let iid = id + '-' + slug(label)
        while (used.has(iid)) iid += 'x'
        used.add(iid)
        return { id: iid, label }
      })
    }))
  }
}

// "Green Areas & Common Land" – done on every inspection.
const COMMON = [
  { id: 'debris', label: 'Debris, litter, stones etc' },
  { id: 'dog', label: 'Dog excrement (if particularly noticeable)' },
  { id: 'fences', label: 'Fences' },
  { id: 'grass', label: 'Grass cutting observations' },
  { id: 'notice', label: 'Notice boards' },
  { id: 'uneven', label: 'Uneven surfaces' },
  { id: 'signs', label: 'Village signs' }
]

const AREAS = [
  area('turkey-farm', 'Turkey Farm', [
    ['Notice board', ['Orchard Map']],
    ['Benches', ['Picnic bench 1 (next to slide)', 'Picnic bench 2 (next to basketball)']],
    ['Play equipment', ['Slide', 'Multi frame', 'Zip line', 'Football posts', 'Basketball hoops & frames']],
    ['Litter bins', ['Bin 1 (car park)', 'Bin 2 (pedestrian entrance)', 'Bin 3 (near bowls club)']],
    ['Dog bins', ['Dog bin 1 (car park)']]
  ]),
  area('burnham-green', 'Burnham Green', [
    ['Signage', ['Burnham Green Village sign', 'Notice board', 'Notice board in bus stop']],
    ['Benches', [
      'Bench 1 (small picnic bench in Park)',
      'Bench 2 (large picnic bench in Park)',
      'Bench 3 (opposite bus stop)',
      'Bench 4 (far end of green)',
      'Bench 3 (memorial bench)',
      'Bench 4 (memorial bench)',
      'Bench 5 (large picnic bench opposite shop)',
      'Bench 6 (small picnic bench opposite shop)'
    ]],
    ['Play equipment', [
      'Slide and frame', 'Baby swing', 'Rocking seat (toy on spring)', 'Double swings and frame',
      'Balance beam (movable)', 'Balance beam', 'Balance beam (on springs)', 'Stepping-stones (wooden steps)'
    ]],
    ['Litter bins', [
      'Bin 1 (along Burnham Green Road)', 'Bin 2 (inside play area)', 'Bin 3 (outside play area)',
      'Bin 4 (outside The Belmont Public House)'
    ]],
    ['Dog bins', ['Dog bin 1 (opposite shop)']]
  ]),
  area('bulls-green', 'Bulls Green', [
    ['Village sign', ['Village sign on Bulls Green']],
    ['Benches', ['Bench 1 (outside The Horns)']],
    ['Bins', ['Bin 1 (outside The Horns)']]
  ]),
  area('village-green', 'Datchworth Village Green', [
    ['Sign', ['Datchworth Village sign']],
    ['Notice boards', ['Notice board (in phone box)', 'Notice board (DPC)']],
    ['Benches', [
      'Bench 1 (near museum)', 'Bench 2 (cricket pitch near Cherry Tree Hall)', 'Bench 3 (cricket pitch)',
      'Bench 4 (cricket pitch memorial)', 'Bench 5 (cricket pitch memorial)', 'Bench 6 (near tennis court by path)',
      'Bench 7 (left hand side of tennis court)', 'Bench 8 (by oak tree & DSC)', 'Bench 9 (in front of play area)',
      'Bench 10 (at rear of play area)', 'Bench 11 (outside village hall)', 'Bench 12 (Wheatcotes Close)'
    ]],
    ['Play equipment', ['Swings (flat seat)', 'Swings (baby)', 'Roundabout']],
    ['Litter bins', [
      'Bin 1 (on Green, opposite museum)', 'Bin 2 (by seat outside Pettits)', 'Bin 3 (just before tennis court)',
      'Bin 4 (tennis court gate)', 'Bin 5 (next to swings)', 'Bin 6 (end of green, near road)'
    ]],
    ['Dog bins', ['Dog bin 1']]
  ]),
  area('nutcroft', 'Nutcroft / Hawkins Hall Lane', [
    ['Benches', ['Bench 1 (next to swings)', 'Bench 2 (top of play area)', 'Bench 3 (bus stop outside No. 48 Nutcroft)']],
    ['Play equipment', ['Climbing frame', 'Baby swings', 'Swings (flat seat)']],
    ['Bins', ['Bin 1 (in Nutcroft Park)', 'Bin 2 (corner of Hawkins Hall Lane and Brookbridge Lane)']],
    ['Dog bins', ['Dog bin 1 (in Nutcroft Park)']]
  ]),
  area('church', 'Church & School Path', [
    ['Notice board', ['DPC Notice board (outside church)']],
    ['Benches', ['Bench 1 (outside church)', 'Bench 2 (outside school)']],
    ['Bins', ['Bin 1 (outside church next to notice board)', 'Bin 2 (outside school)']],
    ['Dog bins', ['Dog bin 1 (outside church)', 'Dog bin 2 (outside school)']]
  ]),
  area('common-land', 'Green Areas & Common Land', [])
]

function defaultSetup() {
  return { version: 2, commonTitle: 'Green Areas & Common Land', common: COMMON.map((c) => ({ ...c })), areas: JSON.parse(JSON.stringify(AREAS)) }
}

// ---- validation of a setup sent by the Clerk --------------------------------

const clip = (s, n) => String(s ?? '').trim().slice(0, n)
const okId = (s) => typeof s === 'string' && /^[\w.-]{1,90}$/.test(s)

function cleanSetup(input) {
  const err = (m) => { const e = new Error(m); e.status = 400; return e }
  if (!input || !Array.isArray(input.areas)) throw err('Checklist is missing')
  const ids = new Set()
  const uniq = (id) => { if (!okId(id) || ids.has(id)) throw err('Checklist has a duplicate or invalid id: ' + id); ids.add(id); return id }
  const common = (input.common || []).map((c) => ({ id: uniq(c.id), label: clip(c.label, 200) })).filter((c) => c.label)
  const areaNames = new Set()
  const areas = input.areas.map((a) => {
    const name = clip(a.name, 120)
    if (!name) throw err('Every area needs a name')
    if (areaNames.has(name.toLowerCase())) throw err('Two areas are called "' + name + '"')
    areaNames.add(name.toLowerCase())
    return {
      id: uniq(a.id),
      name,
      sections: (a.sections || []).map((s) => ({
        id: uniq(s.id),
        title: clip(s.title, 120) || 'Untitled section',
        items: (s.items || []).map((i) => ({ id: uniq(i.id), label: clip(i.label, 200) })).filter((i) => i.label)
      }))
    }
  })
  if (!areas.length) throw err('Keep at least one area')
  return { version: 2, commonTitle: clip(input.commonTitle, 120) || 'Green Areas & Common Land', common, areas }
}

module.exports = { defaultSetup, cleanSetup }
