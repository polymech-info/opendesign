import { useEffect } from "preact/hooks";
import {
  RouterProvider,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from "@tanstack/react-router";
import { AppShell, EditorPage, ExportPage, HomePage } from "./app";
import { webClient } from "./mode";

const rootRoute = createRootRoute({
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const exportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/export/$designId",
  component: ExportPage,
});

const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/design/$designId/{-$panel}",
  component: EditorPage,
});

const routeTree = rootRoute.addChildren([indexRoute, exportRoute, designRoute]);

function RedirectHome() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: "/" });
  }, [navigate]);
  return null;
}

export const router = createRouter({
  routeTree,
  ...(webClient ? { history: createHashHistory() } : {}),
  trailingSlash: "never",
  defaultPreload: false,
  defaultNotFoundComponent: RedirectHome,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}
