import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Organization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

type Membership = {
  organizationId: string;
  role: "admin" | "user";
  organizationName: string;
  organizationSlug: string;
};

type CurrentUser = {
  id: string;
  email: string;
  name: string;
};

type ActiveOrganization = {
  id: string;
  name: string;
  slug: string;
  role: "admin" | "user";
};

type Member = {
  id: string;
  role: "admin" | "user";
  userId: string;
  userName: string;
  userEmail: string;
  createdAt: string;
};

type Invitation = {
  id: string;
  organizationId: string;
  email: string;
  role: "admin" | "user";
  status: "pending" | "accepted" | "revoked";
  createdAt: string;
};

type Zone = {
  id: string;
  organizationId: string;
  name: string;
  provider: string;
  powerdnsZoneId: string;
  createdAt: string;
};

type RecordRow = {
  name: string;
  type: string;
  ttl: number;
  records: Array<{
    content: string;
    disabled?: boolean;
  }>;
};

type DashboardState = {
  loading: boolean;
  error?: string;
  currentUser?: CurrentUser | null;
  memberships: Membership[];
  activeOrganization?: ActiveOrganization | null;
  organizations: Organization[];
  members: Member[];
  invitations: Invitation[];
  zones: Zone[];
};

function isInvitationForCurrentUser(
  invitation: Invitation,
  currentUser: CurrentUser | null | undefined,
) {
  return invitation.email.toLowerCase() === (currentUser?.email ?? "").toLowerCase();
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
  });
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(`Expected JSON but received: ${text.slice(0, 120)}`);
  }

  const data = (await response.json()) as T & { error?: string; ok?: boolean };

  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed with status ${response.status}`);
  }

  return data;
}

function App() {
  const [state, setState] = useState<DashboardState>({
    loading: true,
    memberships: [],
    organizations: [],
    members: [],
    invitations: [],
    zones: [],
  });
  const [activeOrganizationId, setActiveOrganizationId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("new.user@example.com");
  const [inviteRole, setInviteRole] = useState<"admin" | "user">("user");
  const [submitting, setSubmitting] = useState(false);
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null);
  const [acceptingInvitationId, setAcceptingInvitationId] = useState<string | null>(null);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [zoneName, setZoneName] = useState("example.com");
  const [creatingZone, setCreatingZone] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [recordName, setRecordName] = useState("@");
  const [recordType, setRecordType] = useState("A");
  const [recordContent, setRecordContent] = useState("127.0.0.1");
  const [recordTtl, setRecordTtl] = useState("3600");
  const [savingRecord, setSavingRecord] = useState(false);
  const [deletingRecordKey, setDeletingRecordKey] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("test@example.com");
  const [loginName, setLoginName] = useState("Test User");
  const [sendingLoginLink, setSendingLoginLink] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("My Organization");
  const [creatingOrganization, setCreatingOrganization] = useState(false);

  async function loadDashboard() {
    setState((current) => ({ ...current, loading: true, error: undefined }));
    setLoginMessage(null);

    try {
      const sessionResponse = await requestJson<{
        ok: boolean;
        currentUser: CurrentUser | null;
        memberships: Membership[];
        activeOrganization: ActiveOrganization | null;
      }>("/api/session");

      const activeOrganization = sessionResponse.activeOrganization;

      if (!sessionResponse.currentUser || !activeOrganization) {
        setState({
          loading: false,
          currentUser: sessionResponse.currentUser,
          memberships: sessionResponse.memberships,
          activeOrganization: activeOrganization,
          organizations: [],
          members: [],
          invitations: [],
          zones: [],
        });
        return;
      }

      const [organizationsResponse, membersResponse, invitationsResponse, zonesResponse] =
        await Promise.all([
          requestJson<{ ok: boolean; organizations: Organization[] }>("/api/organizations"),
          requestJson<{ ok: boolean; members: Member[] }>(
            `/api/organizations/${activeOrganization.id}/members`,
          ),
          requestJson<{ ok: boolean; invitations: Invitation[] }>(
            `/api/invitations?organizationId=${activeOrganization.id}`,
          ),
          requestJson<{ ok: boolean; zones: Zone[] }>("/api/zones"),
        ]);

      setActiveOrganizationId(activeOrganization.id);
      setSelectedZoneId((current) => current || zonesResponse.zones[0]?.id || "");
      setState({
        loading: false,
        currentUser: sessionResponse.currentUser,
        memberships: sessionResponse.memberships,
        activeOrganization,
        organizations: organizationsResponse.organizations,
        members: membersResponse.members,
        invitations: invitationsResponse.invitations,
        zones: zonesResponse.zones,
      });
    } catch (error) {
      setState({
        loading: false,
        memberships: [],
        organizations: [],
        members: [],
        invitations: [],
        zones: [],
        error: error instanceof Error ? error.message : "Unknown dashboard error",
      });
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    async function loadRecords() {
      if (!selectedZoneId || !state.currentUser || !state.activeOrganization) {
        setRecords([]);
        return;
      }

      setRecordsLoading(true);

      try {
        const response = await requestJson<{ ok: boolean; rrsets: RecordRow[] }>(
          `/api/zones/${selectedZoneId}/records`,
        );
        setRecords(response.rrsets);
      } catch (error) {
        setRecords([]);
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Unknown record loading error",
        }));
      } finally {
        setRecordsLoading(false);
      }
    }

    void loadRecords();
  }, [selectedZoneId, state.currentUser, state.activeOrganization]);

  async function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!state.activeOrganization) {
      return;
    }

    setSubmitting(true);

    try {
      const response = await requestJson<{
        ok: boolean;
        invitation: Invitation;
        mail?: { sent: boolean; id: string | null; error: string | null };
      }>("/api/invitations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
        }),
      });

      await loadDashboard();
      setInviteEmail("another.user@example.com");
      setInviteRole("user");
      setState((current) => ({
        ...current,
        error:
          response.mail && !response.mail.sent
            ? `Invitation created, but email failed: ${response.mail.error ?? "Unknown mail error"}`
            : undefined,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown invitation error",
      }));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendingLoginLink(true);
    setLoginMessage(null);

    try {
      const response = await requestJson<{
        ok: boolean;
        email: string;
        inviteOrganizationName: string | null;
      }>("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: loginEmail,
          name: loginName,
        }),
      });

      setLoginMessage(
        response.inviteOrganizationName
          ? `Login link sent to ${response.email}. It will sign you in and let you join ${response.inviteOrganizationName}.`
          : `Login link sent to ${response.email}.`,
      );
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown login error",
      }));
    } finally {
      setSendingLoginLink(false);
    }
  }

  async function handleLogout() {
    try {
      await requestJson<{ ok: boolean }>("/api/auth/logout", {
        method: "POST",
      });
      setSelectedZoneId("");
      setRecords([]);
      await loadDashboard();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown logout error",
      }));
    }
  }

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingOrganization(true);

    try {
      await requestJson<{ ok: boolean; organization: Organization }>("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationName }),
      });
      await loadDashboard();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown onboarding error",
      }));
    } finally {
      setCreatingOrganization(false);
    }
  }

  async function handleZoneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingZone(true);

    try {
      await requestJson<{ ok: boolean; zone: Zone; provider?: { name: string; zoneId: string } }>(
        "/api/zones",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ name: zoneName }),
        },
      );

      await loadDashboard();
      setZoneName("new-zone.example.com");
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown zone creation error",
      }));
    } finally {
      setCreatingZone(false);
    }
  }

  async function handleRecordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedZoneId) {
      return;
    }

    setSavingRecord(true);

    try {
      const response = await requestJson<{ ok: boolean; rrsets: RecordRow[] }>(
        `/api/zones/${selectedZoneId}/records`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: recordName,
            type: recordType,
            content: recordContent,
            ttl: Number(recordTtl),
          }),
        },
      );
      setRecords(response.rrsets);
      setRecordName("@");
      setRecordType("A");
      setRecordContent("127.0.0.1");
      setRecordTtl("3600");
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown record create error",
      }));
    } finally {
      setSavingRecord(false);
    }
  }

  async function handleDeleteRecord(name: string, type: string, content: string) {
    if (!selectedZoneId) {
      return;
    }

    const key = `${name}:${type}:${content}`;
    setDeletingRecordKey(key);

    try {
      const query = new URLSearchParams({ name, type, content }).toString();
      const response = await requestJson<{ ok: boolean; rrsets: RecordRow[] }>(
        `/api/zones/${selectedZoneId}/records?${query}`,
        {
          method: "DELETE",
        },
      );
      setRecords(response.rrsets);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown record delete error",
      }));
    } finally {
      setDeletingRecordKey(null);
    }
  }

  async function handleOrganizationChange(nextOrganizationId: string) {
    setActiveOrganizationId(nextOrganizationId);

    try {
      await requestJson<{ ok: boolean; activeOrganization: ActiveOrganization }>(
        "/api/session/active-organization",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: nextOrganizationId }),
        },
      );
      await loadDashboard();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown organization change error",
      }));
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    setRevokingInvitationId(invitationId);

    try {
      await requestJson<{ ok: boolean; invitation: Invitation }>(
        `/api/invitations/${invitationId}/revoke`,
        {
          method: "POST",
        },
      );
      await loadDashboard();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown revoke invitation error",
      }));
    } finally {
      setRevokingInvitationId(null);
    }
  }

  async function handleAcceptInvitation(invitationId: string) {
    setAcceptingInvitationId(invitationId);

    try {
      await requestJson<{ ok: boolean; invitation: Invitation }>(
        `/api/invitations/${invitationId}/accept`,
        {
          method: "POST",
        },
      );
      await loadDashboard();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown accept invitation error",
      }));
    } finally {
      setAcceptingInvitationId(null);
    }
  }

  async function handleMemberRoleChange(memberId: string, role: "admin" | "user") {
    if (!state.activeOrganization) {
      return;
    }

    setUpdatingMemberId(memberId);

    try {
      await requestJson<{ ok: boolean; member: Member }>(
        `/api/organizations/${state.activeOrganization.id}/members`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memberId, role }),
        },
      );
      await loadDashboard();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown member update error",
      }));
    } finally {
      setUpdatingMemberId(null);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!state.activeOrganization) {
      return;
    }

    setRemovingMemberId(memberId);

    try {
      await requestJson<{ ok: boolean; member: Member | null }>(
        `/api/organizations/${state.activeOrganization.id}/members?memberId=${memberId}`,
        {
          method: "DELETE",
        },
      );
      await loadDashboard();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unknown member removal error",
      }));
    } finally {
      setRemovingMemberId(null);
    }
  }

  const isOrgAdmin = state.activeOrganization?.role === "admin";
  const selectedZone = state.zones.find((zone) => zone.id === selectedZoneId) ?? null;

  return (
    <main className="app-shell">
      <div className="hero">
        <p className="eyebrow">Multi-tenant DNS manager</p>
        {!state.currentUser ? (
          <>
            <h1>Manage organizations, access and DNS from one place</h1>
            <p className="intro">
              A unified workspace for organizations, invitations, members, DNS zones and records.
              Built to keep each organization isolated in its own DNS environment.
            </p>
          </>
        ) : null}
      </div>

      {state.error ? <p className="banner banner--error">{state.error}</p> : null}
      {state.loading ? <p className="banner">Loading dashboard...</p> : null}

      {!state.loading && !state.currentUser ? (
        <section className="panel panel--highlight">
          <p className="panel__label">Sign in</p>
          <h2>Passwordless email login</h2>
          <p className="intro">
            Enter your email to receive a sign-in link. If you already have an invitation, you can
            accept it after signing in.
          </p>
          <form className="form" onSubmit={(event) => void handleLoginSubmit(event)}>
            <label>
              Name
              <input
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
                type="text"
              />
            </label>

            <label>
              Email
              <input
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                type="email"
                required
              />
            </label>

            <button type="submit" disabled={sendingLoginLink}>
              {sendingLoginLink ? "Sending..." : "Send sign-in link"}
            </button>
          </form>
          {loginMessage ? <p className="banner">{loginMessage}</p> : null}
        </section>
      ) : null}

      {!state.loading && state.currentUser && !state.activeOrganization ? (
        <section className="panel panel--highlight">
          <p className="panel__label">Onboarding</p>
          <h2>Create your first organization</h2>
          <p className="intro">
            Your account is signed in but does not belong to an organization yet. Create one to
            continue to the dashboard.
          </p>
          <form className="form" onSubmit={(event) => void handleCreateOrganization(event)}>
            <label>
              Organization name
              <input
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                type="text"
                required
              />
            </label>

            <button type="submit" disabled={creatingOrganization}>
              {creatingOrganization ? "Creating..." : "Create organization"}
            </button>
          </form>
        </section>
      ) : null}

      {state.currentUser && state.activeOrganization ? (
        <>
          <section className="context-strip panel panel--highlight">
            <div className="context-strip__main">
              <div>
                <p className="panel__label">Signed in as</p>
                <h2>{state.currentUser.name}</h2>
                <p>{state.currentUser.email}</p>
              </div>
              <div>
                <p className="panel__label">Active organization</p>
                <h2>{state.activeOrganization.name}</h2>
                <p>
                  Role: <strong>{state.activeOrganization.role}</strong>
                </p>
              </div>
            </div>
            <div className="context-strip__actions">
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
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleLogout()}
              >
                Sign out
              </button>
            </div>
          </section>

          <div className="dashboard-section">
            <div className="section-heading">
              <div>
                <p className="panel__label">Organization</p>
                <h2>Access and membership</h2>
                <p className="section-subtitle">
                  Manage organization context, members and invitations for the selected tenant.
                </p>
              </div>
            </div>

            <div className="dashboard-grid dashboard-grid--organization">
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
                        {organization.id === state.activeOrganization?.id ? "active" : "available"}
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
                      <div className="actions-row">
                        {isOrgAdmin ? (
                          <select
                            value={member.role}
                            onChange={(event) =>
                              void handleMemberRoleChange(
                                member.id,
                                event.target.value as "admin" | "user",
                              )
                            }
                            disabled={updatingMemberId === member.id}
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                        ) : (
                          <span className="pill">{member.role}</span>
                        )}
                        {isOrgAdmin && member.userId !== state.currentUser?.id ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void handleRemoveMember(member.id)}
                            disabled={removingMemberId === member.id}
                          >
                            {removingMemberId === member.id ? "Removing..." : "Remove"}
                          </button>
                        ) : null}
                      </div>
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
                  <span className="section-tag">Admin workspace</span>
                </div>
                <ul className="list">
                  {state.invitations.length === 0 ? (
                    <li className="empty-state">No invitations yet.</li>
                  ) : null}
                  {state.invitations.map((invitation) => (
                    <li key={invitation.id} className="list__item">
                      <div>
                        <strong>{invitation.email}</strong>
                        <p>{invitation.status}</p>
                      </div>
                      <div className="actions-row">
                        <span className="pill">{invitation.role}</span>
                        {invitation.status === "pending" &&
                        isInvitationForCurrentUser(invitation, state.currentUser) ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void handleAcceptInvitation(invitation.id)}
                            disabled={acceptingInvitationId === invitation.id}
                          >
                            {acceptingInvitationId === invitation.id ? "Accepting..." : "Accept"}
                          </button>
                        ) : null}
                        {invitation.status === "pending" && isOrgAdmin ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void handleRevokeInvitation(invitation.id)}
                            disabled={revokingInvitationId === invitation.id}
                          >
                            {revokingInvitationId === invitation.id ? "Revoking..." : "Revoke"}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>

          <div className="dashboard-section">
            <div className="section-heading">
              <div>
                <p className="panel__label">DNS</p>
                <h2>Zones and records</h2>
                <p className="section-subtitle">
                  Create zones, select an active zone and manage records for the current
                  organization.
                </p>
              </div>
            </div>

            <div className="dashboard-grid dashboard-grid--dns">
              <section className="panel dns-panel dns-panel--zones">
                <div className="panel__header">
                  <div>
                    <p className="panel__label">DNS zones</p>
                    <h2>{state.zones.length}</h2>
                  </div>
                  <span className="section-tag">{isOrgAdmin ? "Admin can edit" : "Read only"}</span>
                </div>
                <ul className="list">
                  {state.zones.length === 0 ? (
                    <li className="empty-state">No zones created yet.</li>
                  ) : null}
                  {state.zones.map((zone) => (
                    <li
                      key={zone.id}
                      className={`list__item zone-list-item${selectedZoneId === zone.id ? " zone-list-item--selected" : ""}`}
                    >
                      <div>
                        <strong>{zone.name}</strong>
                        <p>{zone.provider}</p>
                        <code>{zone.powerdnsZoneId}</code>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setSelectedZoneId(zone.id)}
                      >
                        {selectedZoneId === zone.id ? "Selected" : "Open records"}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="panel dns-panel dns-panel--records">
                <p className="panel__label">Zone records</p>
                <h2>{selectedZone?.name ?? "Select a zone"}</h2>
                <p className="section-subtitle">
                  {selectedZone
                    ? "Records are loaded directly from PowerDNS for the selected zone."
                    : "Choose a zone to inspect and manage its records."}
                </p>
                {recordsLoading ? <p>Loading records...</p> : null}
                {!recordsLoading && selectedZoneId ? (
                  <ul className="list">
                    {records.flatMap((rrset) =>
                      rrset.records.map((record) => {
                        const key = `${rrset.name}:${rrset.type}:${record.content}`;

                        return (
                          <li key={key} className="list__item">
                            <div>
                              <strong>
                                {rrset.name} {rrset.type}
                              </strong>
                              <p>
                                TTL {rrset.ttl} • {record.content}
                              </p>
                            </div>
                            {isOrgAdmin ? (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() =>
                                  void handleDeleteRecord(rrset.name, rrset.type, record.content)
                                }
                                disabled={deletingRecordKey === key}
                              >
                                {deletingRecordKey === key ? "Deleting..." : "Delete"}
                              </button>
                            ) : null}
                          </li>
                        );
                      }),
                    )}
                  </ul>
                ) : null}
                {!recordsLoading && selectedZoneId && records.length === 0 ? (
                  <p className="empty-state">No records found for the selected zone.</p>
                ) : null}
              </section>
            </div>
          </div>

          <div className="dashboard-section">
            <div className="section-heading">
              <div>
                <p className="panel__label">Actions</p>
                <h2>Create and manage</h2>
                <p className="section-subtitle">
                  All creation flows live here. They are only writable for admins in the selected
                  organization.
                </p>
              </div>
            </div>

            <div className="dashboard-grid dashboard-grid--actions">
              <section className="panel">
                <p className="panel__label">Create DNS zone</p>
                <h2>New zone</h2>
                <form className="form" onSubmit={(event) => void handleZoneSubmit(event)}>
                  <label>
                    Zone name
                    <input
                      value={zoneName}
                      onChange={(event) => setZoneName(event.target.value)}
                      type="text"
                      required
                    />
                  </label>

                  <button type="submit" disabled={creatingZone || !isOrgAdmin}>
                    {creatingZone ? "Creating..." : "Create zone"}
                  </button>
                </form>
              </section>

              <section className="panel">
                <p className="panel__label">Create DNS record</p>
                <h2>New record</h2>
                <form className="form" onSubmit={(event) => void handleRecordSubmit(event)}>
                  <label>
                    Zone
                    <select
                      value={selectedZoneId}
                      onChange={(event) => setSelectedZoneId(event.target.value)}
                    >
                      <option value="">Select zone</option>
                      {state.zones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Name
                    <input
                      value={recordName}
                      onChange={(event) => setRecordName(event.target.value)}
                      type="text"
                      required
                    />
                  </label>

                  <label>
                    Type
                    <select
                      value={recordType}
                      onChange={(event) => setRecordType(event.target.value)}
                    >
                      <option value="A">A</option>
                      <option value="AAAA">AAAA</option>
                      <option value="CNAME">CNAME</option>
                      <option value="TXT">TXT</option>
                      <option value="MX">MX</option>
                    </select>
                  </label>

                  <label>
                    Content
                    <input
                      value={recordContent}
                      onChange={(event) => setRecordContent(event.target.value)}
                      type="text"
                      required
                    />
                  </label>

                  <label>
                    TTL
                    <input
                      value={recordTtl}
                      onChange={(event) => setRecordTtl(event.target.value)}
                      type="number"
                      min="1"
                      required
                    />
                  </label>

                  <button type="submit" disabled={savingRecord || !isOrgAdmin || !selectedZoneId}>
                    {savingRecord ? "Saving..." : "Create record"}
                  </button>
                </form>
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
                      onChange={(event) => setInviteRole(event.target.value as "admin" | "user")}
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </label>

                  <button type="submit" disabled={submitting || !isOrgAdmin}>
                    {submitting ? "Saving..." : "Create invitation"}
                  </button>
                </form>
              </section>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}

export default App;
