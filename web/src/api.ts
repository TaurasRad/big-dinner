export type Booking = {
  id: string
  dinnerId?: string
  guestName?: string
  quantity: number
  status: 'hold' | 'paid' | 'cancelled' | 'expired'
  amountCents: number
  holdExpiresAt: string | null
  title?: string
  startsAt?: string
  neighborhood?: string
  hostName?: string
}

export type PaidGuest = {
  guestName: string
  quantity: number
}

export type DinnerCard = {
  id: string
  hostName: string
  title: string
  menu: string
  startsAt: string
  priceCents: number
  maxSeats: number
  neighborhood: string
  seatsTaken: number
  seatsLeft: number
  cancellationCutoff: string
  cancellationOpen: boolean
  myStatus: 'hold' | 'paid' | null
}

export type Dinner = Omit<DinnerCard, 'myStatus'> & {
  addressLine: string | null
  paidGuests: PaidGuest[]
  myBookings: Booking[]
}

export type NewDinner = {
  hostName: string
  title: string
  menu: string
  neighborhood: string
  addressLine: string
  priceCents: number
  maxSeats: number
  startsAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(body.error || 'Request failed')
  }
  return body
}

export function listDinners(guest: string) {
  return request<DinnerCard[]>(`/api/dinners?guest=${encodeURIComponent(guest)}`)
}

export function getDinner(id: string, guest: string) {
  return request<Dinner>(`/api/dinners/${id}?guest=${encodeURIComponent(guest)}`)
}

export function createDinner(input: NewDinner) {
  return request<Dinner>('/api/dinners', { method: 'POST', body: JSON.stringify(input) })
}

export function claimSeat(id: string, guestName: string, quantity: number) {
  return request<Booking>(`/api/dinners/${id}/claim`, {
    method: 'POST',
    body: JSON.stringify({ guestName, quantity }),
  })
}

export function payBooking(id: string, guestName: string) {
  return request<{ booking: Booking; addressLine: string }>(`/api/bookings/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify({ guestName }),
  })
}

export function cancelBooking(id: string, guestName: string) {
  return request<Booking>(`/api/bookings/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ guestName }),
  })
}

export function myBookings(guest: string) {
  return request<Booking[]>(`/api/mine?guest=${encodeURIComponent(guest)}`)
}

export function resetDemo() {
  return request<{ ok: boolean }>('/api/demo/reset', { method: 'POST' })
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

export function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
