import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import "./index.css";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
import { PublicProposal } from "./pages/PublicProposal";

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/app" replace /> },
  { path: "/app/login", element: <Login /> },
  {
    path: "/app",
    element: <RequireAuth />,
    children: [{ index: true, element: <Dashboard /> }],
  },
  { path: "/p/:slug", element: <PublicProposal /> },
  { path: "*", element: <NotFound /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
