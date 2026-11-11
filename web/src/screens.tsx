import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  cancelBooking,
  claimSeat,
  createDinner,
  formatMoney,
  formatWhen,
  getDinner,
  listDinners,
  myBookings,
  payBooking,
  type Booking,
  type Dinner,
  type DinnerCard,
} from './api'
import { usePersona } from './persona'

function SeatMeter({ taken, max }: { taken: number; max: number }) {
  return (
    <div className="meter" aria-hidden="true">
      {Array.from({ length: max }, (_, index) => (
        <span key={index} className={index < taken ? 'dot taken' : 'dot'} />
      ))}
    </div>
  )
}

function Notice({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="alert" role="alert">
      {message}
    </p>
  )
}

export function ListScreen() {
  const { guest, refreshKey } = usePersona()
  const [dinners, setDinners] = useState<DinnerCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    listDinners(guest)
      .then((rows) => {
        if (active) {
          setDinners(rows)
          setError(null)
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
    return () => {
      active = false
    }
  }, [guest, refreshKey])

  return (
    <section className="stack">
      <div>
        <h1>Nearby tables</h1>
        <p className="lede">
          You are {guest}. A seat is held, then paid. The street address stays hidden until that payment.
        </p>
      </div>
      <Notice message={error} />
      {dinners === null ? <p className="muted">Loading tables…</p> : null}
      {dinners?.map((dinner) => (
        <Link key={dinner.id} className="card" to={`/dinner/${dinner.id}`}>
          <p className="eyebrow">{dinner.neighborhood}</p>
          <h2>{dinner.title}</h2>
          <p className="muted">
            {dinner.hostName} cooks · {formatWhen(dinner.startsAt)}
          </p>
          <div className="meta">
            <span>{formatMoney(dinner.priceCents)} a seat</span>
            <span>{dinner.seatsLeft === 0 ? 'Full' : `${dinner.seatsLeft} open`}</span>
            {dinner.myStatus === 'paid' ? <span className="pill">You’re in</span> : null}
            {dinner.myStatus === 'hold' ? <span className="pill hold">On hold</span> : null}
          </div>
        </Link>
      ))}
    </section>
  )
}

export function DetailScreen() {
  const { id = '' } = useParams()
  const { guest, refreshKey } = usePersona()
  const [dinner, setDinner] = useState<Dinner | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const requestKey = `${id}:${guest}:${refreshKey}`
  const [shownKey, setShownKey] = useState(requestKey)
  if (shownKey !== requestKey) {
    setShownKey(requestKey)
    setDinner(null)
    setError(null)
  }

  useEffect(() => {
    let active = true
    getDinner(id, guest)
      .then((row) => {
        if (!active) return
        setDinner(row)
        setError(null)
        setQuantity((current) => Math.min(Math.max(1, current), Math.max(1, row.seatsLeft)))
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
    return () => {
      active = false
    }
  }, [id, guest, refreshKey])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setDinner(await getDinner(id, guest))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That did not work')
    } finally {
      setBusy(false)
    }
  }

  if (!dinner) {
    return (
      <section className="stack">
        <Notice message={error} />
        {error ? <Link to="/">Back to tables</Link> : <p className="muted">Loading the table…</p>}
      </section>
    )
  }

  const hold = dinner.myBookings.find((booking) => booking.status === 'hold')
  const paid = dinner.myBookings.filter((booking) => booking.status === 'paid')
  const hosting = dinner.hostName === guest
  const canClaim = !hosting && !hold && dinner.seatsLeft > 0

  return (
    <section className="stack">
      <Link className="back" to="/">
        All tables
      </Link>
      <div>
        <p className="eyebrow">{dinner.neighborhood}</p>
        <h1>{dinner.title}</h1>
        <p className="muted">
          {dinner.hostName} cooks · {formatWhen(dinner.startsAt)}
        </p>
      </div>
      <p className="menu">{dinner.menu}</p>
      <div className="card flat">
        <div className="meta">
          <strong>
            {dinner.seatsLeft} of {dinner.maxSeats} open
          </strong>
          <span>{formatMoney(dinner.priceCents)} a seat</span>
        </div>
        <SeatMeter taken={dinner.seatsTaken} max={dinner.maxSeats} />
        <p className="muted">
          {dinner.cancellationOpen
            ? `Free cancel until ${formatWhen(dinner.cancellationCutoff)}.`
            : 'The free-cancel window has closed. A paid seat stays taken.'}
        </p>
        {dinner.paidGuests.length > 0 ? (
          <ul className="guests">
            {dinner.paidGuests.map((person) => (
              <li key={person.guestName}>
                {person.guestName} · {person.quantity}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No paid seats yet.</p>
        )}
      </div>
      <Address dinner={dinner} hosting={hosting} paid={paid.length > 0} />
      <Notice message={error} />
      {hosting ? <p className="muted">This is your table. Switch person to join as a guest.</p> : null}
      {canClaim ? (
        <div className="card flat">
          <div className="stepper">
            <button
              type="button"
              aria-label="Fewer seats"
              disabled={busy || quantity <= 1}
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
            >
              −
            </button>
            <span>
              {quantity} {quantity === 1 ? 'seat' : 'seats'}
            </span>
            <button
              type="button"
              aria-label="More seats"
              disabled={busy || quantity >= dinner.seatsLeft}
              onClick={() => setQuantity((current) => Math.min(dinner.seatsLeft, current + 1))}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void run(() => claimSeat(id, guest, quantity).then(() => undefined))}
          >
            Hold {quantity} {quantity === 1 ? 'seat' : 'seats'}
          </button>
        </div>
      ) : null}
      {hold ? <HoldBill hold={hold} busy={busy} onPay={() => void run(async () => { await payBooking(hold.id, guest) })} onDrop={() => void run(async () => { await cancelBooking(hold.id, guest) })} /> : null}
      {paid.map((booking) => (
        <div key={booking.id} className="card flat">
          <p>
            You paid {formatMoney(booking.amountCents)} for {booking.quantity}{' '}
            {booking.quantity === 1 ? 'seat' : 'seats'}.
          </p>
          {dinner.cancellationOpen ? (
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => void run(async () => { await cancelBooking(booking.id, guest) })}
            >
              Cancel and release seats
            </button>
          ) : (
            <p className="muted">Cancellation is closed, so these seats stay taken.</p>
          )}
        </div>
      ))}
      {!hosting && !hold && dinner.seatsLeft === 0 ? <p className="muted">This dinner is full.</p> : null}
    </section>
  )
}

function Address({ dinner, hosting, paid }: { dinner: Dinner; hosting: boolean; paid: boolean }) {
  const open = dinner.addressLine !== null
  return (
    <div className={open ? 'address open' : 'address locked'}>
      <p className="eyebrow">{open ? 'Address' : 'Address locked'}</p>
      {open ? <p className="address-line">{dinner.addressLine}</p> : <p>Hidden until you pay for a seat.</p>}
      {hosting ? <p className="muted">Visible to you because you are the host.</p> : null}
      {paid ? <p className="muted">Visible because your seat is paid. Switch person and it locks again.</p> : null}
    </div>
  )
}

function HoldBill({
  hold,
  busy,
  onPay,
  onDrop,
}: {
  hold: Booking
  busy: boolean
  onPay: () => void
  onDrop: () => void
}) {
  return (
    <div className="card bill">
      <p className="eyebrow">Demo charge</p>
      <p className="price">{formatMoney(hold.amountCents)}</p>
      <p className="muted">
        {hold.quantity} {hold.quantity === 1 ? 'seat' : 'seats'} held
        {hold.holdExpiresAt ? ` until ${formatWhen(hold.holdExpiresAt)}` : ''}. No card leaves this laptop.
      </p>
      <button type="button" className="primary" disabled={busy} onClick={onPay}>
        Pay and confirm
      </button>
      <button type="button" className="ghost" disabled={busy} onClick={onDrop}>
        Drop hold
      </button>
    </div>
  )
}

function eveningIn(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(19, 0, 0, 0)
  return date.toISOString()
}

export function HostScreen() {
  const { guest } = usePersona()
  const navigate = useNavigate()
  const starts = useMemo(
    () => [
      { id: 'soon', label: 'In 3 hours', value: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() },
      { id: 'tomorrow', label: 'Tomorrow at 19:00', value: eveningIn(1) },
      { id: 'later', label: 'In 2 days at 19:00', value: eveningIn(2) },
    ],
    [],
  )
  const [title, setTitle] = useState('Soup and too much bread')
  const [menu, setMenu] = useState('Tomato soup, buttered bread, and a bowl of apples.')
  const [neighborhood, setNeighborhood] = useState('Old Town')
  const [addressLine, setAddressLine] = useState('Lantern Street 5')
  const [price, setPrice] = useState(10)
  const [maxSeats, setMaxSeats] = useState(6)
  const [startsAt, setStartsAt] = useState(starts[1].value)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const dinner = await createDinner({
        hostName: guest,
        title,
        menu,
        neighborhood,
        addressLine,
        priceCents: Math.round(price * 100),
        maxSeats,
        startsAt,
      })
      navigate(`/dinner/${dinner.id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not publish')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="stack">
      <div>
        <h1>Host a dinner</h1>
        <p className="lede">{guest} is cooking. Guests will see the neighborhood only, until they pay.</p>
      </div>
      <form className="stack" onSubmit={(event) => void onSubmit(event)}>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={80} />
        </label>
        <label>
          What’s for dinner
          <textarea value={menu} onChange={(event) => setMenu(event.target.value)} required maxLength={280} rows={3} />
        </label>
        <label>
          Neighborhood
          <input
            value={neighborhood}
            onChange={(event) => setNeighborhood(event.target.value)}
            required
            maxLength={40}
          />
        </label>
        <label>
          Street address
          <input
            value={addressLine}
            onChange={(event) => setAddressLine(event.target.value)}
            required
            maxLength={80}
          />
        </label>
        <div className="split">
          <label>
            Euros per seat
            <input
              type="number"
              min={1}
              max={80}
              value={price}
              onChange={(event) => setPrice(Number(event.target.value))}
              required
            />
          </label>
          <label>
            Max seats
            <select value={maxSeats} onChange={(event) => setMaxSeats(Number(event.target.value))}>
              {[4, 6, 8, 10, 12, 16].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          When
          <select value={startsAt} onChange={(event) => setStartsAt(event.target.value)}>
            {starts.map((choice) => (
              <option key={choice.id} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <Notice message={error} />
        <button type="submit" className="primary" disabled={busy}>
          Publish dinner
        </button>
      </form>
    </section>
  )
}

export function MineScreen() {
  const { guest, refreshKey } = usePersona()
  const [rows, setRows] = useState<Booking[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    myBookings(guest)
      .then((bookings) => {
        if (active) {
          setRows(bookings)
          setError(null)
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
    return () => {
      active = false
    }
  }, [guest, refreshKey])

  return (
    <section className="stack">
      <div>
        <h1>{guest}’s seats</h1>
        <p className="lede">Holds and paid places on the shared local database.</p>
      </div>
      <Notice message={error} />
      {rows === null ? <p className="muted">Loading your seats…</p> : null}
      {rows?.length === 0 ? <p className="muted">No seats yet. Pick a table and hold one.</p> : null}
      {rows?.map((booking) => (
        <Link key={booking.id} className="card" to={`/dinner/${booking.dinnerId}`}>
          <p className="eyebrow">{booking.neighborhood}</p>
          <h2>{booking.title}</h2>
          <div className="meta">
            <span>
              {booking.quantity} {booking.quantity === 1 ? 'seat' : 'seats'} · {formatMoney(booking.amountCents)}
            </span>
            <span className={booking.status === 'paid' ? 'pill' : 'pill hold'}>
              {booking.status === 'paid' ? 'Paid' : 'On hold'}
            </span>
          </div>
        </Link>
      ))}
    </section>
  )
}
