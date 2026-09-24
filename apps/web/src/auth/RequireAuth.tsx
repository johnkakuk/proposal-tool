import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthProvider";

/** Guards /app/*. Unauthenticated visitors go to the login page and come back afterwards. */
export function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  if (!session) return <Navigate to="/app/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
