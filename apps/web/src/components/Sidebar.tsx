import * as React from 'react';
import { NavLink } from 'react-router-dom';
import {
  ChevronUp,
  FileText,
  LayoutDashboard,
  LogOut,
  Users,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Pradžia', icon: LayoutDashboard },
  { to: '/vartotojai', label: 'Vartotojai', icon: Users, disabled: true },
  { to: '/prasymai', label: 'Prašymai', icon: FileText, disabled: true },
];

export interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps): JSX.Element {
  const { user, logout } = useAuth();

  const fullName = user?.fullName ?? 'Naudotojas';
  const initials = user ? initialsFrom(fullName) : '??';

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">
          €
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-tight">Finansai</div>
          <div className="-mt-0.5 truncate text-[11px] text-muted-foreground">
            Aplinkos ministerija
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 text-sm">
        {PRIMARY_NAV.map((item) => {
          if (item.disabled) {
            return (
              <div
                key={item.to}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground cursor-not-allowed opacity-60 min-h-[44px] md:min-h-0 md:py-2"
                aria-disabled="true"
                title="Bus įdiegta vėlesnėje iteracijoje"
              >
                <item.icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                <span className="text-[10px] uppercase">Greitai</span>
              </div>
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors min-h-[44px] md:min-h-0 md:py-2',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-foreground hover:bg-muted',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar className="h-9 w-9">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{fullName}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {user?.role ?? ''}
                </div>
              </div>
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {user?.email ?? ''}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                void logout();
              }}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Atsijungti
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function initialsFrom(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return '??';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  const out = (first + last).toUpperCase();
  return out || '??';
}

export default Sidebar;
