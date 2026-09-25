import { NavLink, Outlet } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";

const NAV = [
  { to: "/app", label: "Proposals", end: true },
  { to: "/app/templates", label: "Templates" },
  { to: "/app/clients", label: "Clients" },
];

export function AppShell() {
  const { session } = useAuth();
  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <span className="font-semibold text-brand">Bridger Digital Proposals</span>
          <nav aria-label="Main" className="flex gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? "bg-slate-100 text-ink" : "text-slate-600 hover:text-ink"}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span className="hidden sm:inline">{session?.user.email}</span>
            <button type="button" onClick={() => supabase.auth.signOut()} className="rounded-md px-2 py-1 hover:bg-slate-100 hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
