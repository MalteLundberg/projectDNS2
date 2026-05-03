import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { RecordList } from "./components/RecordList";
import { ZoneList } from "./components/ZoneList";
import { getErrorMessage, requestJson, splitErrorMessageParts } from "./lib/api-client";
import { getEditableRecordName } from "./lib/records";

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

type DashboardSectionKey = "account" | "access-membership" | "zones-records" | "create-manage";

function isInvitationForCurrentUser(
  invitation: Invitation,
  currentUser: CurrentUser | null | undefined,
) {
  return invitation.email.toLowerCase() === (currentUser?.email ?? "").toLowerCase();
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
  const [deletingZoneId, setDeletingZoneId] = useState<string | null>(null);
  const [editingRecordKey, setEditingRecordKey] = useState<string | null>(null);
  const [editingRecordName, setEditingRecordName] = useState("@");
  const [editingRecordType, setEditingRecordType] = useState("A");
  const [editingRecordContent, setEditingRecordContent] = useState("");
  const [editingRecordTtl, setEditingRecordTtl] = useState("3600");
  const [savingEditedRecord, setSavingEditedRecord] = useState(false);
  const [loginEmail, setLoginEmail] = useState("test@example.com");
  const [loginName, setLoginName] = useState("Test User");
  const [sendingLoginLink, setSendingLoginLink] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [supervisorUsername, setSupervisorUsername] = useState("");
  const [supervisorPassword, setSupervisorPassword] = useState("");
  const [signingInSupervisor, setSigningInSupervisor] = useState(false);
  const [organizationName, setOrganizationName] = useState("My Organization");
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [activeSection, setActiveSection] = useState<DashboardSectionKey>("zones-records");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const errorParts = splitErrorMessageParts(state.error);

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
      setSelectedZoneId((current) => {
        if (current && zonesResponse.zones.some((zone) => zone.id === current)) {
          return current;
        }

        return zonesResponse.zones[0]?.id || "";
      });
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
        error: getErrorMessage(error),
      });
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 720px)");

    function syncMobileLayout() {
      if (!mediaQuery.matches) {
        setMobileMenuOpen(false);
      }
    }

    syncMobileLayout();
    mediaQuery.addEventListener("change", syncMobileLayout);

    return () => {
      mediaQuery.removeEventListener("change", syncMobileLayout);
    };
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
          error: getErrorMessage(error),
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
        error: getErrorMessage(error),
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
        error: getErrorMessage(error),
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
        error: getErrorMessage(error),
      }));
    }
  }

  async function handleSupervisorLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSigningInSupervisor(true);
    setLoginMessage(null);

    try {
      await requestJson<{ ok: boolean; currentUser: CurrentUser }>("/api/auth/password-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: supervisorUsername,
          password: supervisorPassword,
        }),
      });
      setSupervisorPassword("");
      await loadDashboard();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getErrorMessage(error),
      }));
    } finally {
      setSigningInSupervisor(false);
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
        error: getErrorMessage(error),
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
        error: getErrorMessage(error),
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
        error: getErrorMessage(error),
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
        error: getErrorMessage(error),
      }));
    } finally {
      setDeletingRecordKey(null);
    }
  }

  async function handleDeleteZone(zone: Zone) {
    if (!window.confirm(`Delete zone ${zone.name}? This removes it from PowerDNS and the app.`)) {
      return;
    }

    setDeletingZoneId(zone.id);

    try {
      await requestJson<{ ok: boolean; zone: { id: string } }>(`/api/zones/${zone.id}`, {
        method: "DELETE",
      });

      if (selectedZoneId === zone.id) {
        setSelectedZoneId("");
        setRecords([]);
      }

      await loadDashboard();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getErrorMessage(error),
      }));
    } finally {
      setDeletingZoneId(null);
    }
  }

  function startRecordEdit(rrset: RecordRow, content: string) {
    const key = `${rrset.name}:${rrset.type}:${content}`;
    setEditingRecordKey(key);
    setEditingRecordName(getEditableRecordName(rrset.name, selectedZone?.name ?? ""));
    setEditingRecordType(rrset.type);
    setEditingRecordContent(content);
    setEditingRecordTtl(String(rrset.ttl));
  }

  function cancelRecordEdit() {
    setEditingRecordKey(null);
    setEditingRecordName("@");
    setEditingRecordType("A");
    setEditingRecordContent("");
    setEditingRecordTtl("3600");
  }

  async function handleRecordEditSubmit(
    event: FormEvent<HTMLFormElement>,
    currentName: string,
    currentType: string,
    currentContent: string,
  ) {
    event.preventDefault();

    if (!selectedZoneId) {
      return;
    }

    setSavingEditedRecord(true);

    try {
      const response = await requestJson<{ ok: boolean; rrsets: RecordRow[] }>(
        `/api/zones/${selectedZoneId}/records`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currentName,
            currentType,
            currentContent,
            name: editingRecordName,
            type: editingRecordType,
            content: editingRecordContent,
            ttl: Number(editingRecordTtl),
          }),
        },
      );

      setRecords(response.rrsets);
      cancelRecordEdit();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getErrorMessage(error),
      }));
    } finally {
      setSavingEditedRecord(false);
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
        error: getErrorMessage(error),
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
        error: getErrorMessage(error),
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
        error: getErrorMessage(error),
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
        error: getErrorMessage(error),
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
        error: getErrorMessage(error),
      }));
    } finally {
      setRemovingMemberId(null);
    }
  }

  function navigateToSection(sectionId: DashboardSectionKey) {
    setMobileMenuOpen(false);
    setActiveSection(sectionId);
  }

  const isOrgAdmin = state.activeOrganization?.role === "admin";
  const selectedZone = state.zones.find((zone) => zone.id === selectedZoneId) ?? null;
  const isDashboardView = Boolean(state.currentUser && state.activeOrganization);

  return (
    <main className={`app-shell${isDashboardView ? " app-shell--dashboard" : ""}`}>
      {!isDashboardView ? (
        <div className="hero">
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
      ) : null}

      {state.error ? (
        <div className="banner banner--error error-banner" role="alert">
          <strong>{errorParts.message}</strong>
          {errorParts.code ? <p>Error code: {errorParts.code}</p> : null}
          {errorParts.details ? <pre>{errorParts.details}</pre> : null}
        </div>
      ) : null}
      {state.loading ? <p className="banner">Loading dashboard...</p> : null}

      {!state.loading && !state.currentUser ? (
        <>
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

          <section className="panel panel--subtle auth-panel-secondary">
            <div className="auth-panel-secondary__header">
              <div>
                <p className="panel__label">Supervisor</p>
                <h3>Supervisor sign in</h3>
              </div>
              <p className="auth-panel-secondary__copy">Use username and password.</p>
            </div>

            <form
              className="form form--compact"
              onSubmit={(event) => void handleSupervisorLoginSubmit(event)}
            >
              <label>
                Username
                <input
                  value={supervisorUsername}
                  onChange={(event) => setSupervisorUsername(event.target.value)}
                  type="text"
                  autoComplete="username"
                  required
                />
              </label>

              <label>
                Password
                <input
                  value={supervisorPassword}
                  onChange={(event) => setSupervisorPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>

              <button type="submit" disabled={signingInSupervisor}>
                {signingInSupervisor ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </section>
        </>
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
          <button
            type="button"
            className="dashboard-mobile-menu-button"
            aria-expanded={mobileMenuOpen}
            aria-label="Open section menu"
            onClick={() => setMobileMenuOpen((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>

          <div className="dashboard-shell">
            <aside className="dashboard-sidebar" aria-label="Dashboard sections">
              <div className="dashboard-sidebar__identity">
                <strong>{state.activeOrganization.name}</strong>
                <span>{state.activeOrganization.role}</span>
              </div>

              <div
                className={`dashboard-sidebar__nav${mobileMenuOpen ? " dashboard-sidebar__nav--open" : ""}`}
              >
                <button
                  type="button"
                  className={`dashboard-sidebar__link${activeSection === "account" ? " dashboard-sidebar__link--active" : ""}`}
                  onClick={() => navigateToSection("account")}
                >
                  Account
                </button>
                <button
                  type="button"
                  className={`dashboard-sidebar__link${activeSection === "access-membership" ? " dashboard-sidebar__link--active" : ""}`}
                  onClick={() => navigateToSection("access-membership")}
                >
                  Access and membership
                </button>
                <button
                  type="button"
                  className={`dashboard-sidebar__link${activeSection === "zones-records" ? " dashboard-sidebar__link--active" : ""}`}
                  onClick={() => navigateToSection("zones-records")}
                >
                  Zones and records
                </button>
                <button
                  type="button"
                  className={`dashboard-sidebar__link${activeSection === "create-manage" ? " dashboard-sidebar__link--active" : ""}`}
                  onClick={() => navigateToSection("create-manage")}
                >
                  Create and manage
                </button>
              </div>
            </aside>

            <section className="dashboard-main">
              <div className="dashboard-main__inner">
                <header className="dashboard-main__header">
                  <h2>
                    {activeSection === "account"
                      ? "Account"
                      : activeSection === "access-membership"
                        ? "Access and membership"
                        : activeSection === "zones-records"
                          ? "Zones and records"
                          : "Create and manage"}
                  </h2>
                </header>

                {activeSection === "account" ? (
                  <div className="dashboard-grid dashboard-grid--account">
                    <section className="panel">
                      <h3>Profile</h3>
                      <p>{state.currentUser.name}</p>
                    </section>

                    <section className="panel">
                      <h3>Organization</h3>
                      <p>{state.activeOrganization.name}</p>
                      <p className="account-meta">Role: {state.activeOrganization.role}</p>
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
                      <h3>Session</h3>
                      <button
                        type="button"
                        className="secondary-button secondary-button--block"
                        onClick={() => void handleLogout()}
                      >
                        Sign out
                      </button>
                    </section>
                  </div>
                ) : null}

                {activeSection === "access-membership" ? (
                  <div className="dashboard-grid dashboard-grid--organization dashboard-grid--organization-extended">
                    <section className="panel">
                      <h3>Organizations in context</h3>
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
                      <h3>Members</h3>
                      <ul className="list">
                        {state.members.map((member) => (
                          <li key={member.id} className="list__item">
                            <div className="member-summary">
                              <strong>{member.userName}</strong>
                              <p>{member.userEmail}</p>
                            </div>
                            <div className="actions-row actions-row--member">
                              {isOrgAdmin ? (
                                <select
                                  className="role-select"
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
                        <h3>Invitations</h3>
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

                    <section className="panel">
                      <h3>Invite member</h3>
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
                ) : null}

                {activeSection === "zones-records" ? (
                  <div className="dashboard-grid dashboard-grid--dns">
                    <ZoneList
                      zones={state.zones}
                      selectedZoneId={selectedZoneId}
                      isOrgAdmin={isOrgAdmin}
                      deletingZoneId={deletingZoneId}
                      onSelectZone={setSelectedZoneId}
                      onDeleteZone={handleDeleteZone}
                    />

                    <RecordList
                      selectedZoneName={selectedZone?.name ?? null}
                      selectedZoneId={selectedZoneId}
                      recordsLoading={recordsLoading}
                      records={records}
                      isOrgAdmin={isOrgAdmin}
                      editingRecordKey={editingRecordKey}
                      editingRecordName={editingRecordName}
                      editingRecordType={editingRecordType}
                      editingRecordContent={editingRecordContent}
                      editingRecordTtl={editingRecordTtl}
                      savingEditedRecord={savingEditedRecord}
                      deletingRecordKey={deletingRecordKey}
                      onStartRecordEdit={startRecordEdit}
                      onCancelRecordEdit={cancelRecordEdit}
                      onDeleteRecord={handleDeleteRecord}
                      onRecordEditSubmit={handleRecordEditSubmit}
                      setEditingRecordName={setEditingRecordName}
                      setEditingRecordType={setEditingRecordType}
                      setEditingRecordContent={setEditingRecordContent}
                      setEditingRecordTtl={setEditingRecordTtl}
                    />
                  </div>
                ) : null}

                {activeSection === "create-manage" ? (
                  <div className="dashboard-grid dashboard-grid--actions dashboard-grid--actions-compact">
                    <section className="panel action-panel">
                      <form className="form" onSubmit={(event) => void handleZoneSubmit(event)}>
                        <h3>Create DNS zone</h3>
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

                    <section className="panel action-panel">
                      <form className="form" onSubmit={(event) => void handleRecordSubmit(event)}>
                        <h3>Create DNS record</h3>
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
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </>
      ) : null}

    </main>
  );
}

export default App;
