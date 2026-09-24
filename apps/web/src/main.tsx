import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import "./index.css";
import { queryClient } from "./lib/queryClient";
import { NotFound } from "./pages/NotFound";

/**
 * Routes are code-split: the client-facing viewer (/p/*) never downloads the admin app,
 * the editor, or the Supabase SDK. Everything under /app shares one auth boundary.
 */
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => async () => ({ Component: (await load())[name] });

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/app" replace /> },
  {
    path: "/app",
    lazy: page(() => import("./auth/AdminRoot"), "AdminRoot"),
    children: [
      { path: "login", lazy: page(() => import("./pages/Login"), "Login") },
      {
        lazy: page(() => import("./auth/RequireAuth"), "RequireAuth"),
        children: [
          {
            lazy: page(() => import("./components/AppShell"), "AppShell"),
            children: [
              { index: true, lazy: page(() => import("./pages/Dashboard"), "Dashboard") },
              { path: "templates", lazy: page(() => import("./pages/Templates"), "Templates") },
              { path: "clients", lazy: page(() => import("./pages/Clients"), "Clients") },
              { path: "clients/:id", lazy: page(() => import("./pages/ClientDetail"), "ClientDetail") },
              { path: "write-with-ai", lazy: page(() => import("./pages/WriteWithAI"), "WriteWithAI") },
            ],
          },
          // Editors are full-screen, outside the app shell.
          { path: "proposals/:id", lazy: page(() => import("./pages/ProposalEditorPage"), "ProposalEditorPage") },
          { path: "templates/:id", lazy: page(() => import("./pages/TemplateEditorPage"), "TemplateEditorPage") },
        ],
      },
    ],
  },
  { path: "/p/:slug", lazy: page(() => import("./public/PublicProposalPage"), "PublicProposalPage") },
  { path: "*", element: <NotFound /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
