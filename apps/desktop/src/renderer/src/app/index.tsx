import { Dialog, Tooltip } from "@pond/ui";
import type { ShellHint } from "@shared/shell-hint";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createBrowserHistory,
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { ConversionDialogHost } from "@/features/library/components/conversion-dialog/host";
import { FolderPickerHost } from "@/features/library/components/folder-picker";
import { RenameDialogHost } from "@/features/library/components/rename-dialog/host";
import { UpdateDialog } from "@/features/settings/components/update-dialog";
import { isBrowserRuntime } from "@/shared/lib/platform";
import { usePrefs } from "@/shared/state/prefs";
import type { PondApi } from "../../../preload";
import { bindBrowserLibraryHistory } from "../browser/library-history";
import { ExtensionCaptureToast } from "../features/captures/effects/extension-capture-toast";
import { NotificationStatusBridge } from "../features/downloads/effects/notification-status-bridge";
import { EnrichmentSweep } from "../features/enrichment/effects/enrichment-sweep";
import { CommandMenuHost } from "../features/library/components/command-menu";
import { useHydrateFolders } from "../features/library/state/folders";
import { libraryChrome } from "../features/library/state/library-chrome";
import { syncPrimaryFromPath } from "../features/saves/lib/save-nav";
import { ThemeApplier } from "../features/settings/effects/theme-applier";
import { UiSounds } from "../features/settings/effects/ui-sounds";
import { RefreshBlockedToast } from "../features/sources/effects/refresh-blocked-toast";
import { SyncStatusBridge } from "../features/sources/effects/sync-status-bridge";
import { routeTree } from "../routeTree.gen";
import { ToastHost } from "../shared/components/toast-host";
import { setAppRouter } from "../shared/lib/app-router";
import { libraryScopedKey } from "../shared/lib/library-scope";
import { BootScreen } from "./components/boot-screen";
import { ErrorBoundary } from "./components/error-boundary";
import { ErrorScreen } from "./components/error-screen";
import { FishIntroDialog } from "./components/fish-intro-dialog";
import { PromptHost } from "./components/prompts";
import { SetupHost } from "./components/setup";
import { SupportDialog } from "./components/support-dialog";
import { WhatsNewDialog } from "./components/whats-new-dialog";
import { AgentLibraryBridge } from "./effects/agent-library-bridge";
import { FishOpenBridge } from "./effects/fish-open-bridge";
import { LibraryIdentityBridge } from "./effects/library-identity-bridge";
import { MachinePace } from "./effects/machine-pace";
import { MenuRecentsBridge } from "./effects/menu-recents-bridge";
import "./effects/save-library-bridge";

const DuplicateReviewHost = lazy(() =>
  import("@/features/library/components/duplicate-review").then((module) => ({
    default: module.DuplicateReviewHost,
  })),
);
const OrganizationReviewHost = lazy(() =>
  import("@/features/library/components/smart-collection-review").then(
    (module) => ({ default: module.OrganizationReviewHost }),
  ),
);
const BrowserHostLocations = lazy(() =>
  import("./components/browser-host-locations").then((module) => ({
    default: module.BrowserHostLocations,
  })),
);
const BrowserCombineHost = lazy(() =>
  import("./components/browser-combine-host").then((module) => ({
    default: module.BrowserCombineHost,
  })),
);
declare global {
  interface Window {
    pond: PondApi;
    __pondShell?: ShellHint;
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof buildRouter>;
  }
}

const LAST_PATH_KEY = libraryScopedKey("pond:lastPath");
const STARTUP_PAGE_KEY = "pond:startupPage";

const STARTUP_ROUTES: ReadonlyMap<string, string> = new Map([
  ["library", "/"],
  ["sources", "/sources"],
  ["trash", "/trash"],
]);

function readStored(key: string): string | null {
  if (!("localStorage" in globalThis)) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function initialPath(): string {
  if (
    isBrowserRuntime() &&
    (location.pathname !== "/" || location.search || location.hash)
  )
    return `${location.pathname}${location.search}${location.hash}`;
  const startup = readStored(STARTUP_PAGE_KEY) ?? "continue";
  if (startup === "settings") return "/settings/general";
  const startupRoute = STARTUP_ROUTES.get(startup);
  if (startup !== "continue" && startupRoute) return startupRoute;
  const last = readStored(LAST_PATH_KEY) || "/";
  if (last.startsWith("/dev")) return "/";
  return last;
}

function buildRouter(entry: string) {
  const history = isBrowserRuntime()
    ? createBrowserHistory()
    : createMemoryHistory({ initialEntries: [entry] });
  if (isBrowserRuntime() && location.pathname === "/" && entry !== "/")
    history.replace(entry);
  return createRouter({
    routeTree,
    history,
    defaultPreload: "intent",
    defaultErrorComponent: ({ error, reset }) => (
      <ErrorScreen error={error} reset={reset} />
    ),
  });
}

function AppContent() {
  const [router] = useState(() => {
    const next = buildRouter(initialPath());
    setAppRouter(next);
    return next;
  });

  useLayoutEffect(() => {
    if (!isBrowserRuntime()) return;
    return bindBrowserLibraryHistory(router.history, {
      getNav: () => libraryChrome.getState().nav,
      setNav: libraryChrome.setNav,
    });
  }, [router]);

  useEffect(() => {
    const unsub = router.subscribe("onResolved", () => {
      const loc = router.state.location;
      try {
        localStorage.setItem(
          LAST_PATH_KEY,
          isBrowserRuntime() ? `${loc.pathname}${loc.searchStr}` : loc.pathname,
        );
      } catch {}
      syncPrimaryFromPath(loc.pathname);
      setAppRouter(router);
    });
    return unsub;
  }, [router]);

  useEffect(() => {
    setAppRouter(router);
    syncPrimaryFromPath(router.state.location.pathname);
  }, [router]);

  return <RouterProvider router={router} />;
}

export function App() {
  return <LibraryApp />;
}

function LibraryApp() {
  useHydrateFolders();

  const [windowPrefs] = usePrefs("window");
  const startupPage = windowPrefs?.startupPage;
  useEffect(() => {
    if (!startupPage) return;
    try {
      localStorage.setItem(STARTUP_PAGE_KEY, startupPage);
    } catch {}
  }, [startupPage]);
  useEffect(
    () =>
      window.pond.onFullScreenChange((fullScreen) =>
        document.documentElement.toggleAttribute(
          "data-full-screen",
          fullScreen,
        ),
      ),
    [],
  );

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );

  return (
    <MotionConfig reducedMotion="user">
      <HotkeysProvider
        defaultOptions={{
          hotkey: { ignoreInputs: true },
          hotkeySequence: { ignoreInputs: true },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <Tooltip.Provider>
            <Dialog.PortalProvider>
              <MachinePace />
              <ThemeApplier />
              <UiSounds />
              <NotificationStatusBridge />
              <MenuRecentsBridge />
              <LibraryIdentityBridge />
              <AgentLibraryBridge />
              <FishOpenBridge />
              <SyncStatusBridge />
              <ExtensionCaptureToast />
              <RefreshBlockedToast />
              <EnrichmentSweep />
              <BootScreen />
              <SetupHost />
              <ErrorBoundary>
                <AppContent />
              </ErrorBoundary>
              <Dialog.Host />
              <FolderPickerHost />
              <RenameDialogHost />
              <Suspense fallback={null}>
                <DuplicateReviewHost />
                <OrganizationReviewHost />
                {isBrowserRuntime() && <BrowserCombineHost />}
                {isBrowserRuntime() && <BrowserHostLocations />}
              </Suspense>
              <ConversionDialogHost />
              <UpdateDialog />
              <WhatsNewDialog />
              <SupportDialog />
              <PromptHost />
              <FishIntroDialog />
              <CommandMenuHost />
              <ToastHost />
            </Dialog.PortalProvider>
          </Tooltip.Provider>
        </QueryClientProvider>
      </HotkeysProvider>
    </MotionConfig>
  );
}
