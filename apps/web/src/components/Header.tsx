import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface HeaderProps {
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps): JSX.Element {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4 md:px-6">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-11 w-11 md:hidden md:h-10 md:w-10"
        aria-label="Atidaryti meniu"
        onClick={onOpenSidebar}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <div className="flex-1" />
    </header>
  );
}

export default Header;
