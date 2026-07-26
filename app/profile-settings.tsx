"use client";

import { FormEvent, useState } from "react";

type ProfileUser = {
  id: number | null;
  name: string;
  email: string;
  picture: string | null;
  provider: string;
  role: "admin" | "member";
};

type Props = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  user: ProfileUser;
  onUpdated: (user: ProfileUser) => void;
  setNotice: (message: string) => void;
};

export function ProfileSettings({
  apiFetch,
  user,
  onUpdated,
  setNotice,
}: Props) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isLocal = user.provider === "local";
  const hasProfile = user.id !== null;

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload: {
        name?: string;
        email?: string;
        currentPassword?: string;
        newPassword?: string;
      } = {};
      if (name.trim() !== user.name) payload.name = name;
      if (isLocal && email.trim().toLowerCase() !== user.email.toLowerCase()) {
        payload.email = email;
      }
      if (isLocal && newPassword) payload.newPassword = newPassword;
      if (payload.email || payload.newPassword) {
        payload.currentPassword = currentPassword;
      }
      if (Object.keys(payload).length === 0) {
        setNotice("No profile changes to save.");
        return;
      }
      const response = await apiFetch("/api/profile", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        user?: ProfileUser;
        error?: string;
      };
      if (!response.ok || !result.user) {
        throw new Error(result.error ?? "Unable to update profile.");
      }
      onUpdated(result.user);
      setCurrentPassword("");
      setNewPassword("");
      setNotice("Profile updated.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="page-heading users-heading">
        <div>
          <p className="eyebrow">Personal settings</p>
          <h1>
            Your
            <br />
            <em>profile.</em>
          </h1>
          <p className="heading-copy">
            Update your display name and, for local accounts, rotate your email
            address and password.
          </p>
        </div>
      </section>

      <section className="profile-layout">
        <aside className="panel profile-summary">
          <div className="profile-avatar">
            {user.name
              .split(/\s+/)
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <div className="profile-badges">
            <span>{user.role}</span>
            <span>{user.provider === "local" ? "local account" : `${user.provider} SSO`}</span>
          </div>
        </aside>

        <section className="panel profile-form-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Account details</p>
              <h2>Edit profile</h2>
            </div>
          </div>
          {!hasProfile ? (
            <div className="users-empty">
              Recovery and development identities do not have editable profiles.
            </div>
          ) : (
            <form className="profile-form" onSubmit={saveProfile}>
              <div className="field">
                <label htmlFor="profile-name">Display name</label>
                <input
                  id="profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="profile-email">Email address</label>
                <input
                  id="profile-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={!isLocal}
                  autoComplete="email"
                  required
                />
                {!isLocal && (
                  <small>Your SSO provider manages this email address.</small>
                )}
              </div>
              {isLocal && (
                <>
                  <div className="profile-separator">
                    <strong>Credentials</strong>
                    <span>Leave the new password blank to keep it unchanged.</span>
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="profile-current-password">
                        Current password
                      </label>
                      <input
                        id="profile-current-password"
                        type="password"
                        value={currentPassword}
                        onChange={(event) =>
                          setCurrentPassword(event.target.value)
                        }
                        autoComplete="current-password"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="profile-new-password">New password</label>
                      <input
                        id="profile-new-password"
                        type="password"
                        minLength={12}
                        maxLength={128}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  <small className="profile-help">
                    Changing your email or password requires your current
                    password. Password changes revoke your other sessions.
                  </small>
                </>
              )}
              {error && <p className="form-error">{error}</p>}
              <div className="profile-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          )}
        </section>
      </section>
    </>
  );
}
