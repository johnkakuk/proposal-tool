import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { AppShell } from "./components/AppShell";
import "./index.css";
import { queryClient } from "./lib/queries";
import { ClientDetail } from "./pages/ClientDetail";
import { Clients } from "./pages/Clients";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
import { ProposalEditorPage } from "./pages/ProposalEditorPage";
import { PublicProposal } from "./pages/PublicProposal";
import { TemplateEditorPage } from "./pages/TemplateEditorPage";
import { Templates } from "./pages/Templates";
import { WriteWithAI } from "./pages/WriteWithAI";

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/app" replace /> },
  { path: "/app/login", element: <Login /> },
  {
    path: "/app",
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: "templates", element: <Templates /> },
          { path: "clients", element: <Clients /> },
          { path: "clients/:id", element: <ClientDetail /> },
          { path: "write-with-ai", element: <WriteWithAI /> },
        ],
      },
      // Editors are full-screen, outside the app shell.
      { path: "proposals/:id", element: <ProposalEditorPage /> },
      { path: "templates/:id", element: <TemplateEditorPage /> },
    ],
  },
  { path: "/p/:slug", element: <PublicProposal /> },
  { path: "*", element: <NotFound /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
