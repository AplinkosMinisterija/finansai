import * as React from 'react';
import { Outlet } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';

export function Layout(): JSX.Element {
  const [sidebarOpen, setSidebarOpen] = React.useState<boolean>(false);

  return (
    <div className="flex h-screen overflow-hidden bg-secondary/40">
      <a
        href="#main-content"
        className="sr-only z-[100] focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:inline-flex focus:items-center focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Pereiti prie turinio
      </a>

      <div className="hidden md:flex">
        <Sidebar />
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0"
          aria-label="Pagrindinis meniu"
        >
          <SheetTitle className="sr-only">Pagrindinis meniu</SheetTitle>
          <SheetDescription className="sr-only">
            Naršymas tarp Finansai aplikacijos ekranų.
          </SheetDescription>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto focus:outline-none"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default Layout;
