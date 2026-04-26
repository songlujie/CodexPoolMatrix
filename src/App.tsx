import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { AppShellLayout } from "@/components/AppShellLayout";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();
const Router = typeof window !== "undefined" && window.codexPoolDesktop?.isElectron ? HashRouter : BrowserRouter;
const Index = lazy(() => import("./pages/Index.tsx"));
const TasksPage = lazy(() => import("./pages/Tasks.tsx"));
const ModelCallsPage = lazy(() => import("./pages/ModelCalls.tsx"));
const SettingsPage = lazy(() => import("./pages/Settings.tsx"));
const LogsPage = lazy(() => import("./pages/Logs.tsx"));

function PageContentFallback() {
  return (
    <div className="flex-1 min-w-0 grid place-items-center text-sm text-muted-foreground">
      Loading...
    </div>
  );
}

function RoutedPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageContentFallback />}>{children}</Suspense>;
}

const App = () => (
  <ErrorBoundary>
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Sonner />
            <Router>
              <Routes>
                <Route element={<AppShellLayout />}>
                  <Route path="/" element={<RoutedPage><Index /></RoutedPage>} />
                  <Route path="/tasks" element={<RoutedPage><TasksPage /></RoutedPage>} />
                  <Route path="/model-calls" element={<RoutedPage><ModelCallsPage /></RoutedPage>} />
                  <Route path="/settings" element={<RoutedPage><SettingsPage /></RoutedPage>} />
                  <Route path="/logs" element={<RoutedPage><LogsPage /></RoutedPage>} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Router>
          </TooltipProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;
