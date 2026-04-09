import { useEffect, useState } from 'react'

type ApiStatus = {
  ok: boolean
  service: string
  message: string
  timestamp?: string
}

type StatusState = {
  loading: boolean
  data?: ApiStatus
  error?: string
}

const initialState: StatusState = {
  loading: true,
}

async function loadStatus(endpoint: string): Promise<ApiStatus> {
  const response = await fetch(endpoint)

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return (await response.json()) as ApiStatus
}

function StatusCard({
  title,
  state,
}: {
  title: string
  state: StatusState
}) {
  const statusLabel = state.loading
    ? 'Checking...'
    : state.data?.ok
      ? 'OK'
      : 'Error'

  return (
    <section className="status-card">
      <div className="status-card__header">
        <h2>{title}</h2>
        <span
          className={`status-pill ${state.data?.ok ? 'status-pill--ok' : 'status-pill--error'}`}
        >
          {statusLabel}
        </span>
      </div>

      {state.loading ? <p>Kontrollerar endpoint...</p> : null}
      {state.error ? <p>{state.error}</p> : null}
      {state.data ? (
        <>
          <p>{state.data.message}</p>
          {state.data.timestamp ? <code>{state.data.timestamp}</code> : null}
        </>
      ) : null}
    </section>
  )
}

function App() {
  const [health, setHealth] = useState<StatusState>(initialState)
  const [dbCheck, setDbCheck] = useState<StatusState>(initialState)

  useEffect(() => {
    let active = true

    async function runChecks() {
      const [healthResult, dbResult] = await Promise.allSettled([
        loadStatus('/api/health'),
        loadStatus('/api/db-check'),
      ])

      if (!active) {
        return
      }

      setHealth(
        healthResult.status === 'fulfilled'
          ? { loading: false, data: healthResult.value }
          : { loading: false, error: healthResult.reason instanceof Error ? healthResult.reason.message : 'Unknown error' },
      )

      setDbCheck(
        dbResult.status === 'fulfilled'
          ? { loading: false, data: dbResult.value }
          : { loading: false, error: dbResult.reason instanceof Error ? dbResult.reason.message : 'Unknown error' },
      )
    }

    void runChecks()

    return () => {
      active = false
    }
  }, [])

  return (
    <main className="app-shell">
      <div className="hero">
        <p className="eyebrow">Vite + TypeScript + Vercel Serverless</p>
        <h1>Frontend till backend till Neon PostgreSQL</h1>
        <p className="intro">
          Minsta fungerande version som verifierar att frontend kan anropa serverless-
          endpoints och att backend kan nå Neon via <code>DATABASE_URL</code>.
        </p>
      </div>

      <div className="status-grid">
        <StatusCard title="Health status" state={health} />
        <StatusCard title="DB status" state={dbCheck} />
      </div>
    </main>
  )
}

export default App
