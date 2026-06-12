import * as React from 'react';
import { Outlet } from 'react-router-dom';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';

const SIDEBAR_COLLAPSED_KEY = 'finansai:sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function Layout(): JSX.Element {
  const [sidebarOpen, setSidebarOpen] = React.useState<boolean>(false);
  // Suskleidžiamas desktop sidebar'as (icon-rail). Būsena išlieka tarp sesijų.
  const [collapsed, setCollapsed] = React.useState<boolean>(readCollapsed);

  const toggleCollapsed = React.useCallback((): void => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // localStorage nepasiekiamas (pvz. privatus režimas) — būsena tik sesijai.
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-secondary/40">
      <a
        href="#main-content"
        className="sr-only z-[100] focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:inline-flex focus:items-center focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Pereiti prie turinio
      </a>

      <div className="hidden md:flex">
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0" aria-label="Pagrindinis meniu">
          <SheetTitle className="sr-only">Pagrindinis meniu</SheetTitle>
          <SheetDescription className="sr-only">
            Naršymas tarp Finansai aplikacijos ekranų.
          </SheetDescription>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto focus:outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default Layout;
