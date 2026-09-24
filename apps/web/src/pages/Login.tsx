import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { supabase, supabaseConfigured } from "../lib/supabase";

type Status = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string } | { kind: "sent"; email: string };

/**
 * Owner login: email + password, or a magic link. There is no sign-up: public signups
 * are disabled in Supabase, and magic links never create users (shouldCreateUser: false).
 */
export function Login() {
  const { session } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const from = (location.state as { from?: string } | null)?.from ?? "/app";

  if (session) return <Navigate to={from} replace />;

  async function signInWithPassword(e: FormEvent) {
    e.preventDefault();
    setStatus({ kind: "working" });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setStatus(error ? { kind: "error", message: error.message } : { kind: "idle" });
  }

  async function sendMagicLink() {
    if (!email) return setStatus({ kind: "error", message: "Enter your email first." });
    setStatus({ kind: "working" });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/app` },
    });
    setStatus(error ? { kind: "error", message: error.message } : { kind: "sent", email });
  }

  const working = status.kind === "working";

  return (
    <main className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold text-brand">Bridger Proposals</h1>
        <p className="mb-6 text-sm text-slate-500">Sign in to manage proposals.</p>

        {!supabaseConfigured && (
          <p role="alert" className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Supabase isn't configured. Copy <code>apps/web/.env.example</code> to <code>.env.local</code>.
          </p>
        )}

        <form onSubmit={signInWithPassword} className="space-y-3 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <label className="block text-sm font-medium">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <button
            type="submit"
            disabled={working || !password}
            className="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={sendMagicLink}
            disabled={working}
            className="w-full rounded-md px-4 py-2 text-sm font-medium text-brand ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            Email me a magic link
          </button>

          {status.kind === "error" && (
            <p role="alert" className="text-sm text-red-700">
              {status.message}
            </p>
          )}
          {status.kind === "sent" && (
            <p role="status" className="text-sm text-emerald-700">
              If {status.email} has an account, a sign-in link is on its way.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
