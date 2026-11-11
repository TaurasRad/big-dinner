const base = process.env.API || 'http://127.0.0.1:8787'

async function post(path, body) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  return { status: response.status, payload }
}

const startsAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
const created = await post('/api/dinners', {
  hostName: 'Lukas',
  title: 'Race-test stew',
  menu: 'A pot used only to prove two people cannot take the same last seats.',
  neighborhood: 'Old Town',
  addressLine: 'Hidden Yard 1',
  priceCents: 500,
  maxSeats: 4,
  startsAt,
})

if (created.status !== 201) {
  console.error('Could not create the test dinner', created)
  process.exit(1)
}

const [first, second] = await Promise.all([
  post(`/api/dinners/${created.payload.id}/claim`, { guestName: 'Jonas', quantity: 3 }),
  post(`/api/dinners/${created.payload.id}/claim`, { guestName: 'Aiste', quantity: 3 }),
])

const statuses = [first.status, second.status].sort((a, b) => a - b)
const dinner = await fetch(`${base}/api/dinners/${created.payload.id}`).then((response) => response.json())
const ok = statuses[0] === 201 && statuses[1] === 409 && dinner.seatsTaken === 3

console.log(
  JSON.stringify(
    {
      claims: [first.status, second.status],
      seatsTaken: dinner.seatsTaken,
      seatsLeft: dinner.seatsLeft,
      errors: [first.payload.error, second.payload.error].filter(Boolean),
    },
    null,
    2,
  ),
)

process.exit(ok ? 0 : 1)
