import { Outlet } from "react-router";
import { Toaster } from "../components/Toaster";
import { AuthProvider } from "./AuthProvider";

/** Root of /app: the Supabase session lives here, so public pages never load it. */
export function AdminRoot() {
  return (
    <AuthProvider>
      <Toaster>
        <Outlet />
      </Toaster>
    </AuthProvider>
  );
}
