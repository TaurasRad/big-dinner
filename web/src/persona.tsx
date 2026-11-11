import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export const PEOPLE = ['Hanna', 'Jonas', 'Marta', 'Aiste', 'Lukas'] as const
export type Person = (typeof PEOPLE)[number]

const STORAGE_KEY = 'big-dinner.persona'

type PersonaValue = {
  guest: Person
  setGuest: (guest: Person) => void
  refreshKey: number
  refresh: () => void
}

const PersonaContext = createContext<PersonaValue | null>(null)

function storedGuest(): Person {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && PEOPLE.includes(saved as Person)) return saved as Person
  return 'Jonas'
}

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [guest, setGuestState] = useState<Person>(storedGuest)
  const [refreshKey, setRefreshKey] = useState(0)
  const value = useMemo<PersonaValue>(
    () => ({
      guest,
      setGuest: (next) => {
        localStorage.setItem(STORAGE_KEY, next)
        setGuestState(next)
      },
      refreshKey,
      refresh: () => setRefreshKey((current) => current + 1),
    }),
    [guest, refreshKey],
  )
  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>
}

export function usePersona() {
  const value = useContext(PersonaContext)
  if (!value) throw new Error('usePersona must be used inside PersonaProvider')
  return value
}
