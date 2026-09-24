import { Outlet } from "react-router";
import { AuthProvider } from "./AuthProvider";

/** Root of /app: the Supabase session lives here, so public pages never load it. */
export function AdminRoot() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}
