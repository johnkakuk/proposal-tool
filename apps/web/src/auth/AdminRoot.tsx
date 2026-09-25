import { Outlet } from "react-router";
import { Toaster } from "../components/Toaster";
import { FontGate } from "../render/ThemeScope";
import { AuthProvider } from "./AuthProvider";

/** Root of /app: the Supabase session lives here, so public pages never load it. */
export function AdminRoot() {
  return (
    <FontGate families={["Inter"]} weights={[400, 500, 600, 700]} fullScreen>
      <AuthProvider>
        <Toaster>
          <Outlet />
        </Toaster>
      </AuthProvider>
    </FontGate>
  );
}
