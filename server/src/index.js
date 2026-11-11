import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dataDir = path.join(root, 'data')
const port = Number(process.env.PORT || 8787)

const db = new PGlite(dataDir)

function fail(status, message) {
  const error = new Error(message)
  error.status = status
  throw error
}

function cents(value) {
  const number = Number(value)
  if (!Number.isInteger(number)) return null
  return number
}

function readQuantity(value) {
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 16) {
    fail(400, 'Choose between 1 and 16 seats')
  }
  return quantity
}

function readName(value) {
  const name = String(value || '').trim()
  if (!/^[\p{L}][\p{L} .'-]{0,39}$/u.test(name)) {
    fail(400, 'Use a first name, up to 40 characters')
  }
  return name
}

function iso(value) {
  return new Date(value).toISOString()
}

function cutoffFor(startsAt) {
  return new Date(new Date(startsAt).getTime() - 2 * 60 * 60 * 1000)
}

async function expireHolds(client = db) {
  await client.query(
    `update bookings set status = 'expired' where status = 'hold' and hold_expires_at <= now()`,
  )
}

async function seatsTaken(client, dinnerId) {
  const result = await client.query(
    `select coalesce(sum(quantity), 0)::int as taken
     from bookings
     where dinner_id = $1 and status in ('hold', 'paid')`,
    [dinnerId],
  )
  return Number(result.rows[0].taken)
}

function publicDinner(row, taken) {
  const cutoff = cutoffFor(row.starts_at)
  const seatsTaken = Number(taken)
  return {
    id: row.id,
    hostName: row.host_name,
    title: row.title,
    menu: row.menu,
    startsAt: iso(row.starts_at),
    priceCents: Number(row.price_cents),
    maxSeats: Number(row.max_seats),
    neighborhood: row.neighborhood,
    seatsTaken,
    seatsLeft: Number(row.max_seats) - seatsTaken,
    cancellationCutoff: cutoff.toISOString(),
    cancellationOpen: cutoff.getTime() > Date.now(),
  }
}

async function setup() {
  await db.exec(`
    create table if not exists dinners (
      id uuid primary key,
      host_name text not null,
      title text not null,
      menu text not null,
      starts_at timestamptz not null,
      price_cents integer not null check (price_cents > 0),
      max_seats integer not null check (max_seats between 4 and 16),
      neighborhood text not null,
      address_line text not null,
      status text not null default 'published' check (status in ('published', 'cancelled'))
    );

    create table if not exists bookings (
      id uuid primary key,
      dinner_id uuid not null references dinners(id),
      guest_name text not null,
      quantity integer not null check (quantity > 0),
      status text not null check (status in ('hold', 'paid', 'cancelled', 'expired')),
      amount_cents integer not null,
      hold_expires_at timestamptz,
      created_at timestamptz not null default now()
    );
  `)
  const existing = await db.query('select count(*)::int as count from dinners')
  if (Number(existing.rows[0].count) === 0) await seed()
}

async function seed() {
  const dinners = [
    {
      host: 'Hanna',
      title: 'Chicken, bread, and a long table',
      menu: 'Roast chicken, potatoes, green salad, and a loaf from the corner bakery. One pot, many plates.',
      starts: new Date(Date.now() + 36 * 60 * 60 * 1000),
      price: 1200,
      max: 8,
      neighborhood: 'Old Town',
      address: 'Birch Lane 12, second floor',
      paid: [],
    },
    {
      host: 'Lukas',
      title: 'Thursday pasta',
      menu: 'Tomato pasta, fennel salad, and fruit. Vegetarian. The kitchen fits six, and four seats are already taken.',
      starts: new Date(Date.now() + 20 * 60 * 60 * 1000),
      price: 900,
      max: 6,
      neighborhood: 'Station district',
      address: 'Market Yard 4',
      paid: [
        ['Aiste', 2],
        ['Jonas', 2],
      ],
    },
    {
      host: 'Hanna',
      title: 'Late soup, window already shut',
      menu: 'Lentil soup and cheese toast. Marta has two seats, and the free-cancel window has closed.',
      starts: new Date(Date.now() + 90 * 60 * 1000),
      price: 700,
      max: 4,
      neighborhood: 'Riverside',
      address: 'River Path 8',
      paid: [['Marta', 2]],
    },
  ]

  await db.transaction(async (tx) => {
    for (const dinner of dinners) {
      const id = randomUUID()
      await tx.query(
        `insert into dinners
          (id, host_name, title, menu, starts_at, price_cents, max_seats, neighborhood, address_line)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          dinner.host,
          dinner.title,
          dinner.menu,
          dinner.starts.toISOString(),
          dinner.price,
          dinner.max,
          dinner.neighborhood,
          dinner.address,
        ],
      )
      for (const [guest, quantity] of dinner.paid) {
        await tx.query(
          `insert into bookings
            (id, dinner_id, guest_name, quantity, status, amount_cents)
           values ($1, $2, $3, $4, 'paid', $5)`,
          [randomUUID(), id, guest, quantity, dinner.price * quantity],
        )
      }
    }
  })
}

async function reset() {
  await db.exec('truncate bookings, dinners')
  await seed()
}

async function listDinners(guestName) {
  await expireHolds()
  const dinners = await db.query(
    `select d.*, coalesce(sum(b.quantity) filter (where b.status in ('hold', 'paid')), 0)::int as taken
     from dinners d
     left join bookings b on b.dinner_id = d.id
     where d.status = 'published'
     group by d.id
     order by d.starts_at`,
  )
  const mine = guestName
    ? await db.query(
        `select distinct on (dinner_id) dinner_id, status
         from bookings
         where guest_name = $1 and status in ('hold', 'paid')
         order by dinner_id, case status when 'paid' then 0 else 1 end, created_at desc`,
        [guestName],
      )
    : { rows: [] }
  const mineByDinner = new Map(mine.rows.map((row) => [row.dinner_id, row.status]))
  return dinners.rows.map((row) => ({
    ...publicDinner(row, row.taken),
    myStatus: mineByDinner.get(row.id) || null,
  }))
}

async function getDinner(id, guestName) {
  await expireHolds()
  const result = await db.query('select * from dinners where id = $1', [id])
  const row = result.rows[0]
  if (!row || row.status !== 'published') fail(404, 'Dinner not found')
  const taken = await seatsTaken(db, id)
  const paid = await db.query(
    `select guest_name, sum(quantity)::int as quantity
     from bookings
     where dinner_id = $1 and status = 'paid'
     group by guest_name
     order by guest_name`,
    [id],
  )
  const mine = guestName
    ? await db.query(
        `select * from bookings
         where dinner_id = $1 and guest_name = $2 and status in ('hold', 'paid')
         order by created_at desc`,
        [id, guestName],
      )
    : { rows: [] }
  const canSeeAddress =
    guestName === row.host_name || mine.rows.some((booking) => booking.status === 'paid')
  return {
    ...publicDinner(row, taken),
    addressLine: canSeeAddress ? row.address_line : null,
    paidGuests: paid.rows.map((guest) => ({
      guestName: guest.guest_name,
      quantity: Number(guest.quantity),
    })),
    myBookings: mine.rows.map(presentBooking),
  }
}

function presentBooking(row) {
  return {
    id: row.id,
    dinnerId: row.dinner_id,
    guestName: row.guest_name,
    quantity: Number(row.quantity),
    status: row.status,
    amountCents: Number(row.amount_cents),
    holdExpiresAt: row.hold_expires_at ? iso(row.hold_expires_at) : null,
  }
}

async function claimSeat(dinnerId, guestName, quantity) {
  return db.transaction(async (tx) => {
    await expireHolds(tx)
    const found = await tx.query(
      `select * from dinners where id = $1 and status = 'published' for update`,
      [dinnerId],
    )
    const dinner = found.rows[0]
    if (!dinner) fail(404, 'Dinner not found')
    if (dinner.host_name === guestName) {
      fail(400, 'You are hosting this one, so your seat is already at the table')
    }
    const existing = await tx.query(
      `select id from bookings
       where dinner_id = $1 and guest_name = $2 and status = 'hold'`,
      [dinnerId, guestName],
    )
    if (existing.rows.length > 0) {
      fail(409, 'You already have seats on hold. Pay or drop them first')
    }
    const taken = await seatsTaken(tx, dinnerId)
    const seatsLeft = Number(dinner.max_seats) - taken
    if (quantity > seatsLeft) {
      fail(409, seatsLeft <= 0 ? 'This dinner is full' : `Only ${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left`)
    }
    const inserted = await tx.query(
      `insert into bookings
        (id, dinner_id, guest_name, quantity, status, amount_cents, hold_expires_at)
       values ($1, $2, $3, $4, 'hold', $5, now() + interval '10 minutes')
       returning *`,
      [randomUUID(), dinnerId, guestName, quantity, Number(dinner.price_cents) * quantity],
    )
    return presentBooking(inserted.rows[0])
  })
}

async function payBooking(bookingId, guestName) {
  return db.transaction(async (tx) => {
    const found = await tx.query(`select * from bookings where id = $1 for update`, [bookingId])
    const booking = found.rows[0]
    if (!booking || booking.guest_name !== guestName) fail(404, 'Booking not found')
    if (booking.status !== 'hold') fail(409, 'Those seats are not waiting for payment')
    if (new Date(booking.hold_expires_at).getTime() <= Date.now()) {
      await tx.query(`update bookings set status = 'expired' where id = $1`, [bookingId])
      fail(409, 'The hold expired and the seats were released')
    }
    const updated = await tx.query(
      `update bookings set status = 'paid', hold_expires_at = null where id = $1 returning *`,
      [bookingId],
    )
    const dinner = await tx.query('select address_line from dinners where id = $1', [booking.dinner_id])
    return {
      booking: presentBooking(updated.rows[0]),
      addressLine: dinner.rows[0].address_line,
    }
  })
}

async function cancelBooking(bookingId, guestName) {
  return db.transaction(async (tx) => {
    const found = await tx.query(`select * from bookings where id = $1 for update`, [bookingId])
    const booking = found.rows[0]
    if (!booking || booking.guest_name !== guestName) fail(404, 'Booking not found')
    if (booking.status === 'hold') {
      const updated = await tx.query(
        `update bookings set status = 'expired' where id = $1 returning *`,
        [bookingId],
      )
      return presentBooking(updated.rows[0])
    }
    if (booking.status !== 'paid') fail(409, 'This booking is already closed')
    const dinner = await tx.query('select starts_at from dinners where id = $1', [booking.dinner_id])
    if (cutoffFor(dinner.rows[0].starts_at).getTime() <= Date.now()) {
      fail(409, 'The cancellation window has closed, so this seat stays taken')
    }
    const updated = await tx.query(
      `update bookings set status = 'cancelled' where id = $1 returning *`,
      [bookingId],
    )
    return presentBooking(updated.rows[0])
  })
}

async function myBookings(guestName) {
  await expireHolds()
  const result = await db.query(
    `select b.*, d.title, d.starts_at, d.neighborhood, d.host_name
     from bookings b
     join dinners d on d.id = b.dinner_id
     where b.guest_name = $1 and b.status in ('hold', 'paid')
     order by d.starts_at`,
    [guestName],
  )
  return result.rows.map((row) => ({
    ...presentBooking(row),
    title: row.title,
    startsAt: iso(row.starts_at),
    neighborhood: row.neighborhood,
    hostName: row.host_name,
  }))
}

async function createDinner(body) {
  const hostName = readName(body.hostName)
  const title = String(body.title || '').trim()
  const menu = String(body.menu || '').trim()
  const neighborhood = String(body.neighborhood || '').trim()
  const addressLine = String(body.addressLine || '').trim()
  const priceCents = cents(body.priceCents)
  const maxSeats = cents(body.maxSeats)
  const startsAt = new Date(body.startsAt)
  if (title.length < 3 || title.length > 80) fail(400, 'Give the dinner a short title')
  if (menu.length < 3 || menu.length > 280) fail(400, 'Describe the meal in a sentence or two')
  if (neighborhood.length < 2 || neighborhood.length > 40) fail(400, 'Name the neighborhood')
  if (addressLine.length < 4 || addressLine.length > 80) fail(400, 'Add the street address guests will need')
  if (!priceCents || priceCents < 100 || priceCents > 8000) fail(400, 'Price a seat between €1 and €80')
  if (!maxSeats || maxSeats < 4 || maxSeats > 16) fail(400, 'A home dinner seats 4 to 16')
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() + 30 * 60 * 1000) {
    fail(400, 'Start the dinner at least 30 minutes from now')
  }
  if (startsAt.getTime() > Date.now() + 72 * 60 * 60 * 1000) {
    fail(400, 'Keep it inside the next 72 hours')
  }
  const id = randomUUID()
  await db.query(
    `insert into dinners
      (id, host_name, title, menu, starts_at, price_cents, max_seats, neighborhood, address_line)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, hostName, title, menu, startsAt.toISOString(), priceCents, maxSeats, neighborhood, addressLine],
  )
  return getDinner(id, hostName)
}

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 20_000) fail(413, 'Request is too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    fail(400, 'Send JSON')
  }
}

await setup()

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const guest = url.searchParams.get('guest')
    const guestName = guest ? readName(guest) : ''
    const parts = url.pathname.split('/').filter(Boolean)

    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { ok: true })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/demo/reset') {
      await reset()
      send(res, 200, { ok: true })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/dinners') {
      send(res, 200, await listDinners(guestName))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/dinners') {
      send(res, 201, await createDinner(await readBody(req)))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/mine') {
      if (!guestName) fail(400, 'Choose who you are')
      send(res, 200, await myBookings(guestName))
      return
    }
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'dinners' && parts.length === 3) {
      send(res, 200, await getDinner(parts[2], guestName))
      return
    }
    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'dinners' && parts[3] === 'claim') {
      const body = await readBody(req)
      send(res, 201, await claimSeat(parts[2], readName(body.guestName), readQuantity(body.quantity)))
      return
    }
    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'bookings' && parts.length === 4) {
      const body = await readBody(req)
      const name = readName(body.guestName)
      if (parts[3] === 'pay') {
        send(res, 200, await payBooking(parts[2], name))
        return
      }
      if (parts[3] === 'cancel') {
        send(res, 200, await cancelBooking(parts[2], name))
        return
      }
    }
    send(res, 404, { error: 'Not found' })
  } catch (error) {
    const status = error.status || 500
    if (status === 500) console.error(error)
    send(res, status, { error: status === 500 ? 'Something went wrong' : error.message })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Big dinner API on http://127.0.0.1:${port}`)
})
