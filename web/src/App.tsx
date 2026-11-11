import { NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { PEOPLE, usePersona } from './persona'
import { DetailScreen, HostScreen, ListScreen, MineScreen } from './screens'
import { resetDemo } from './api'

export function App() {
  const { guest, setGuest, refresh } = usePersona()
  const navigate = useNavigate()

  async function onReset() {
    await resetDemo()
    refresh()
    navigate('/')
  }

  return (
    <div className="stage">
      <div className="phone">
        <header className="top">
          <div className="brand">
            <p className="mark">Big dinner</p>
            <p className="tag">Chip in for a seat at someone’s table.</p>
          </div>
          <div className="who" role="group" aria-label="Browse as">
            {PEOPLE.map((person) => (
              <button
                key={person}
                type="button"
                className={person === guest ? 'person on' : 'person'}
                aria-pressed={person === guest}
                onClick={() => setGuest(person)}
              >
                {person}
              </button>
            ))}
          </div>
        </header>
        <main className="screen">
          <Routes>
            <Route path="/" element={<ListScreen />} />
            <Route path="/dinner/:id" element={<DetailScreen />} />
            <Route path="/host" element={<HostScreen />} />
            <Route path="/mine" element={<MineScreen />} />
          </Routes>
        </main>
        <footer className="dock">
          <nav className="tabs" aria-label="Primary">
            <NavLink to="/" end>
              Tables
            </NavLink>
            <NavLink to="/host">Host</NavLink>
            <NavLink to="/mine">Yours</NavLink>
          </nav>
          <button type="button" className="reset" onClick={() => void onReset()}>
            Reset demo
          </button>
        </footer>
      </div>
    </div>
  )
}
