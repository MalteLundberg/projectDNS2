import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type Organization = {
  id: string
  name: string
  slug: string
  createdAt: string
}

type Member = {
  id: string
  role: 'admin' | 'user'
  userId: string
  userName: string
  userEmail: string
  createdAt: string
}

type Invitation = {
  id: string
  organizationId: string
  email: string
  role: 'admin' | 'user'
  status: 'pending' | 'accepted' | 'revoked'
  createdAt: string
}

type DashboardState = {
  loading: boolean
  error?: string
  organizations: Organization[]
  members: Member[]
  invitations: Invitation[]
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const data = (await response.json()) as T & { error?: string }

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with status ${response.status}`)
  }

  return data
}

function App() {
  const [state, setState] = useState<DashboardState>({
    loading: true,
    organizations: [],
    members: [],
    invitations: [],
  })
  const [inviteEmail, setInviteEmail] = useState('new.user@example.com')
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user')
  const [submitting, setSubmitting] = useState(false)

  async function loadDashboard() {
    setState((current) => ({ ...current, loading: true, error: undefined }))

    try {
      const organizationsResponse = await requestJson<{ ok: boolean; organizations: Organization[] }>(
        '/api/organizations',
      )

      const organizations = organizationsResponse.organizations
      const firstOrganization = organizations[0]

      if (!firstOrganization) {
        setState({ loading: false, organizations: [], members: [], invitations: [] })
        return
      }

      const [membersResponse, invitationsResponse] = await Promise.all([
        requestJson<{ ok: boolean; members: Member[] }>(
          `/api/organizations/${firstOrganization.id}/members`,
        ),
        requestJson<{ ok: boolean; invitations: Invitation[] }>(
          `/api/invitations?organizationId=${firstOrganization.id}`,
        ),
      ])

      setState({
        loading: false,
        organizations,
        members: membersResponse.members,
        invitations: invitationsResponse.invitations,
      })
    } catch (error) {
      setState({
        loading: false,
        organizations: [],
        members: [],
        invitations: [],
        error: error instanceof Error ? error.message : 'Unknown dashboard error',
      })
    }
  }

  useEffect(() => {
    void loadDashboard()
  }, [])

  async function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!state.organizations[0]) {
      return
    }

    setSubmitting(true)

    try {
      await requestJson<{ ok: boolean; invitation: Invitation }>('/api/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId: state.organizations[0].id,
          email: inviteEmail,
          role: inviteRole,
          invitedByEmail: 'test@example.com',
        }),
      })

      await loadDashboard()
      setInviteEmail('another.user@example.com')
      setInviteRole('user')
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unknown invitation error',
      }))
    } finally {
      setSubmitting(false)
    }
  }

  const currentOrganization = state.organizations[0]

  return (
    <main className="app-shell">
      <div className="hero">
        <p className="eyebrow">Multitenant foundation</p>
        <h1>Organizations, members and invitations</h1>
        <p className="intro">
          Enkel dashboard ovanpa Neon PostgreSQL med Drizzle-migrationer och seedad
          testdata. Ingen auth eller RLS anvaends i detta steg.
        </p>
      </div>

      {state.error ? <p className="banner banner--error">{state.error}</p> : null}
      {state.loading ? <p className="banner">Laddar dashboard...</p> : null}

      {currentOrganization ? (
        <div className="dashboard-grid">
          <section className="panel panel--highlight">
            <p className="panel__label">Organization</p>
            <h2>{currentOrganization.name}</h2>
            <p>Slug: {currentOrganization.slug}</p>
            <code>{currentOrganization.id}</code>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="panel__label">Members</p>
                <h2>{state.members.length}</h2>
              </div>
            </div>
            <ul className="list">
              {state.members.map((member) => (
                <li key={member.id} className="list__item">
                  <div>
                    <strong>{member.userName}</strong>
                    <p>{member.userEmail}</p>
                  </div>
                  <span className="pill">{member.role}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="panel__label">Invitations</p>
                <h2>{state.invitations.length}</h2>
              </div>
            </div>
            <ul className="list">
              {state.invitations.map((invitation) => (
                <li key={invitation.id} className="list__item">
                  <div>
                    <strong>{invitation.email}</strong>
                    <p>{invitation.status}</p>
                  </div>
                  <span className="pill">{invitation.role}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <p className="panel__label">Create invitation</p>
            <h2>Invite member</h2>
            <form className="form" onSubmit={(event) => void handleInviteSubmit(event)}>
              <label>
                Email
                <input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  type="email"
                  required
                />
              </label>

              <label>
                Role
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as 'admin' | 'user')}
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </label>

              <button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : 'Create invitation'}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default App
