"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type ManagedUser = {
  id: number;
  provider: string;
  email: string;
  name: string;
  picture: string | null;
  role: "admin" | "member";
  active: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

type UserManagementProps = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  currentUserId: number | null;
  setNotice: (message: string) => void;
};

const emptyUser: {
  name: string;
  email: string;
  password: string;
  role: "admin" | "member";
} = {
  name: "",
  email: "",
  password: "",
  role: "member" as const,
};

function userInitials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function dateLabel(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function UserManagement({
  apiFetch,
  currentUserId,
  setNotice,
}: UserManagementProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyUser, setBusyUser] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [form, setForm] = useState(emptyUser);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiFetch("/api/users", { cache: "no-store" });
      const payload = (await response.json()) as {
        users?: ManagedUser[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load users.");
      }
      setUsers(payload.users ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load users.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    queueMicrotask(() => void loadUsers());
  }, [loadUsers]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const response = await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to add user.");
      }
      setForm(emptyUser);
      setShowCreate(false);
      setNotice("Local user created.");
      await loadUsers();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to add user.",
      );
    }
  }

  async function updateUser(
    user: ManagedUser,
    changes: Partial<Pick<ManagedUser, "role" | "active">>,
  ) {
    if (
      changes.active === false &&
      !window.confirm(`Disable “${user.name}” and revoke their sessions?`)
    ) {
      return;
    }
    setBusyUser(user.id);
    setError("");
    try {
      const response = await apiFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update user.");
      }
      setNotice("User access updated.");
      await loadUsers();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update user.",
      );
    } finally {
      setBusyUser(null);
    }
  }

  async function deleteUser(user: ManagedUser) {
    if (
      !window.confirm(
        `Permanently delete “${user.name}”? Their active sessions will be revoked.`,
      )
    ) {
      return;
    }
    setBusyUser(user.id);
    setError("");
    try {
      const response = await apiFetch(`/api/users/${user.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to delete user.");
      }
      setNotice("User deleted.");
      await loadUsers();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete user.",
      );
    } finally {
      setBusyUser(null);
    }
  }

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetUser) return;
    setBusyUser(resetUser.id);
    setError("");
    try {
      const response = await apiFetch(`/api/users/${resetUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password: resetPassword }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reset password.");
      }
      setResetPassword("");
      setResetUser(null);
      setNotice("Password reset and existing sessions revoked.");
      await loadUsers();
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Unable to reset password.",
      );
    } finally {
      setBusyUser(null);
    }
  }

  const activeUsers = users.filter((user) => user.active).length;
  const administrators = users.filter(
    (user) => user.active && user.role === "admin",
  ).length;

  return (
    <>
      <section className="page-heading users-heading">
        <div>
          <p className="eyebrow">Management access</p>
          <h1>
            Users &amp;
            <br />
            <em>permissions.</em>
          </h1>
          <p className="heading-copy">
            Manage local credentials and the authorization state of identities
            created through your OIDC providers.
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setError("");
            setShowCreate(true);
          }}
        >
          <span aria-hidden="true">+</span>
          Add local user
        </button>
      </section>

      <section className="user-summary" aria-label="User metrics">
        <article>
          <span>Active users</span>
          <strong>{activeUsers}</strong>
        </article>
        <article>
          <span>Administrators</span>
          <strong>{administrators}</strong>
        </article>
        <article>
          <span>Local accounts</span>
          <strong>
            {users.filter((user) => user.provider === "local").length}
          </strong>
        </article>
        <article>
          <span>SSO identities</span>
          <strong>
            {users.filter((user) => user.provider !== "local").length}
          </strong>
        </article>
      </section>

      <section className="panel users-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Access directory</p>
            <h2>Management users</h2>
          </div>
          <span className="format-pill">{users.length} accounts</span>
        </div>

        {error && <p className="user-error">{error}</p>}
        {isLoading ? (
          <div className="users-empty">Loading users…</div>
        ) : users.length === 0 ? (
          <div className="users-empty">No management users yet.</div>
        ) : (
          <div className="user-list">
            {users.map((user) => {
              const isSelf = currentUserId === user.id;
              return (
                <article
                  className={`user-row ${user.active ? "" : "inactive"}`}
                  key={user.id}
                >
                  <div className="user-avatar">{userInitials(user.name)}</div>
                  <div className="user-identity">
                    <strong>
                      {user.name}
                      {isSelf && <small>you</small>}
                    </strong>
                    <span>{user.email}</span>
                  </div>
                  <div className="user-provider">
                    <span>{user.provider === "local" ? "Local" : "SSO"}</span>
                    <small>{user.provider}</small>
                  </div>
                  <label className="user-role">
                    <span className="sr-only">Role for {user.name}</span>
                    <select
                      value={user.role}
                      disabled={busyUser === user.id || isSelf}
                      onChange={(event) =>
                        updateUser(user, {
                          role: event.target.value as "admin" | "member",
                        })
                      }
                    >
                      <option value="member">Member</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </label>
                  <div className="user-last-login">
                    <span>Last sign-in</span>
                    <small title={dateLabel(user.lastLoginAt)}>
                      {dateLabel(user.lastLoginAt)}
                    </small>
                  </div>
                  <div className="user-state">
                    <button
                      type="button"
                      className={user.active ? "enabled" : "disabled"}
                      disabled={busyUser === user.id || isSelf}
                      onClick={() =>
                        updateUser(user, { active: !user.active })
                      }
                    >
                      <i />
                      {user.active ? "Active" : "Disabled"}
                    </button>
                  </div>
                  <div className="user-actions">
                    {user.provider === "local" && (
                      <button
                        type="button"
                        disabled={busyUser === user.id}
                        onClick={() => {
                          setError("");
                          setResetUser(user);
                        }}
                      >
                        Reset password
                      </button>
                    )}
                    <button
                      type="button"
                      className="delete-user"
                      disabled={busyUser === user.id || isSelf}
                      onClick={() => deleteUser(user)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showCreate && (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCreate(false);
          }}
        >
          <aside
            className="source-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-title"
          >
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Local authentication</p>
                <h2 id="create-user-title">Add a user</h2>
              </div>
              <button
                type="button"
                aria-label="Close user form"
                onClick={() => setShowCreate(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={createUser}>
              <div className="field">
                <label htmlFor="user-name">Display name</label>
                <input
                  id="user-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  autoComplete="name"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="user-email">Email address</label>
                <input
                  id="user-email"
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  autoComplete="email"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="user-password">Temporary password</label>
                <input
                  id="user-password"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                  autoComplete="new-password"
                  required
                />
                <small>Use 12–128 characters. Share it out of band.</small>
              </div>
              <div className="field">
                <label htmlFor="user-role">Role</label>
                <select
                  id="user-role"
                  value={form.role}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      role: event.target.value as "admin" | "member",
                    })
                  }
                >
                  <option value="member">Member</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              {error && <p className="form-error">{error}</p>}
              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  Create user
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {resetUser && (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setResetUser(null);
          }}
        >
          <aside
            className="source-drawer password-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
          >
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Credential reset</p>
                <h2 id="reset-password-title">Set new password</h2>
              </div>
              <button
                type="button"
                aria-label="Close password reset"
                onClick={() => setResetUser(null)}
              >
                ×
              </button>
            </div>
            <p className="drawer-copy">
              Reset the password for <strong>{resetUser.email}</strong>. All of
              their current sessions will be revoked.
            </p>
            <form onSubmit={submitPasswordReset}>
              <div className="field">
                <label htmlFor="reset-password">New password</label>
                <input
                  id="reset-password"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  autoComplete="new-password"
                  autoFocus
                  required
                />
              </div>
              {error && <p className="form-error">{error}</p>}
              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setResetUser(null)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  Reset password
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
