import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type Organization = {
  id: string
  name: string
  slug: string
  createdAt: string
}

type Membership = {
  organizationId: string
  role: 'admin' | 'user'
  organizationName: string
  organizationSlug: string
}

type CurrentUser = {
  id: string
  email: string
  name: string
}

type ActiveOrganization = {
  id: string
  name: string
  slug: string
  role: 'admin' | 'user'
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
  currentUser?: CurrentUser | null
  memberships: Membership[]
  activeOrganization?: ActiveOrganization | null
  organizations: Organization[]
  members: Member[]
  invitations: Invitation[]
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    ...init,
  })
  const contentType = response.headers.get('content-type') ?? ''

  if (!contentType.includes('application/json')) {
    const text = await response.text()
    throw new Error(`Expected JSON but received: ${text.slice(0, 120)}`)
  }

  const data = (await response.json()) as T & { error?: string }

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with status ${response.status}`)
  }

  return data
}

function App() {
  const [state, setState] = useState<DashboardState>({
    loading: true,
    memberships: [],
    organizations: [],
    members: [],
    invitations: [],
  })
  const [activeOrganizationId, setActiveOrganizationId] = useState('')
  const [inviteEmail, setInviteEmail] = useState('new.user@example.com')
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user')
  const [submitting, setSubmitting] = useState(false)
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null)

  async function loadDashboard() {
    setState((current) => ({ ...current, loading: true, error: undefined }))

    try {
      const sessionResponse = await requestJson<{
        ok: boolean
        currentUser: CurrentUser | null
        memberships: Membership[]
        activeOrganization: ActiveOrganization | null
      }>('/api/session')

      const activeOrganization = sessionResponse.activeOrganization

      if (!sessionResponse.currentUser || !activeOrganization) {
        setState({
          loading: false,
          currentUser: sessionResponse.currentUser,
          memberships: sessionResponse.memberships,
          activeOrganization: activeOrganization,
          organizations: [],
          members: [],
          invitations: [],
        })
        return
      }

      const [organizationsResponse, membersResponse, invitationsResponse] = await Promise.all([
        requestJson<{ ok: boolean; organizations: Organization[] }>('/api/organizations'),
        requestJson<{ ok: boolean; members: Member[] }>(
          `/api/organizations/${activeOrganization.id}/members`,
        ),
        requestJson<{ ok: boolean; invitations: Invitation[] }>(
          `/api/invitations?organizationId=${activeOrganization.id}`,
        ),
      ])

      setActiveOrganizationId(activeOrganization.id)
      setState({
        loading: false,
        currentUser: sessionResponse.currentUser,
        memberships: sessionResponse.memberships,
        activeOrganization,
        organizations: organizationsResponse.organizations,
        members: membersResponse.members,
        invitations: invitationsResponse.invitations,
      })
    } catch (error) {
      setState({
        loading: false,
        memberships: [],
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

    if (!state.activeOrganization) {
      return
    }

    setSubmitting(true)

    try {
      await requestJson<{ ok: boolean; invitation: Invitation }>('/api/invitations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
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

  async function handleOrganizationChange(nextOrganizationId: string) {
    setActiveOrganizationId(nextOrganizationId)

    try {
      await requestJson<{ ok: boolean; activeOrganization: ActiveOrganization }>(
        '/api/session/active-organization',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId: nextOrganizationId }),
        },
      )
      await loadDashboard()
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unknown organization change error',
      }))
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    setRevokingInvitationId(invitationId)

    try {
      await requestJson<{ ok: boolean; invitation: Invitation }>(
        `/api/invitations/${invitationId}/revoke`,
        {
          method: 'POST',
        },
      )
      await loadDashboard()
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unknown revoke invitation error',
      }))
    } finally {
      setRevokingInvitationId(null)
    }
  }

  return (
    <main className="app-shell">
      <div className="hero">
        <p className="eyebrow">Cookie session foundation</p>
        <h1>Current user and active organization</h1>
        <p className="intro">
          Enkel session- och organization-cookie som gor user context stabilt i Vercel och
          forbereder databaskontext for framtida RLS.
        </p>
      </div>

      {state.error ? <p className="banner banner--error">{state.error}</p> : null}
      {state.loading ? <p className="banner">Laddar dashboard...</p> : null}

      {state.currentUser && state.activeOrganization ? (
        <div className="dashboard-grid">
          <section className="panel panel--highlight">
            <p className="panel__label">Current user</p>
            <h2>{state.currentUser.name}</h2>
            <p>{state.currentUser.email}</p>
            <code>{state.currentUser.id}</code>
          </section>

          <section className="panel panel--highlight">
            <p className="panel__label">Active organization</p>
            <h2>{state.activeOrganization.name}</h2>
            <p>Role: {state.activeOrganization.role}</p>
            <label className="inline-field">
              <span>Choose organization</span>
              <select
                value={activeOrganizationId}
                onChange={(event) => void handleOrganizationChange(event.target.value)}
              >
                {state.memberships.map((membership) => (
                  <option key={membership.organizationId} value={membership.organizationId}>
                    {membership.organizationName} ({membership.role})
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="panel">
            <p className="panel__label">Organizations in context</p>
            <h2>{state.organizations.length}</h2>
            <ul className="list">
              {state.organizations.map((organization) => (
                <li key={organization.id} className="list__item">
                  <div>
                    <strong>{organization.name}</strong>
                    <p>{organization.slug}</p>
                  </div>
                  <span className="pill">
                    {organization.id === state.activeOrganization?.id ? 'active' : 'available'}
                  </span>
                </li>
              ))}
            </ul>
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
                  <div className="actions-row">
                    <span className="pill">{invitation.role}</span>
                    {invitation.status === 'pending' ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void handleRevokeInvitation(invitation.id)}
                        disabled={revokingInvitationId === invitation.id}
                      >
                        {revokingInvitationId === invitation.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    ) : null}
                  </div>
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
