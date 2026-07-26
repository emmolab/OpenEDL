"use client";

import { FormEvent, useState } from "react";

type InitialSetupProps = {
  onComplete(): Promise<void>;
};

export function InitialSetup({ onComplete }: InitialSetupProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Unable to create the administrator.",
        );
      }
      setPassword("");
      setConfirmation("");
      await onComplete();
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "Unable to create the administrator.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card setup-card">
        <div className="brand-mark" aria-hidden="true">
          OE
        </div>
        <p className="eyebrow">First-run setup</p>
        <h1>Create your administrator</h1>
        <p>
          This is a new OpenEDL database. Create the local account that will
          manage users, SSO, sources, and published lists.
        </p>
        <div className="setup-notice">
          This screen closes permanently after the first account is created.
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={submit}>
          <label htmlFor="setup-name">Display name</label>
          <input
            id="setup-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            minLength={2}
            maxLength={100}
            autoFocus
            required
          />
          <label htmlFor="setup-email">Email address</label>
          <input
            id="setup-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            maxLength={254}
            required
          />
          <label htmlFor="setup-password">Password</label>
          <input
            id="setup-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
          <span className="field-hint">Use 12–128 characters.</span>
          <label htmlFor="setup-password-confirmation">Confirm password</label>
          <input
            id="setup-password-confirmation"
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
          <button
            className="primary-button"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating administrator…" : "Create administrator"}
          </button>
        </form>
      </section>
    </main>
  );
}
