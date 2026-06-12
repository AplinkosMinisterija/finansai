import * as React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Banknote,
  BarChart3,
  Briefcase,
  Building2,
  ChevronUp,
  Coins,
  ExternalLink,
  FileBarChart,
  FileText,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Tags,
  Users,
  Wallet,
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
import { canManageClassifiers, canManageTenants, canViewPayroll, roleLabel } from '@/lib/roles';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  adminOnly?: boolean;
}

interface NavItemEx extends NavItem {
  classifiersAdminOnly?: boolean;
  payrollAccessOnly?: boolean;
}

const PRIMARY_NAV: NavItemEx[] = [
  // Iter 17 (eksperimentinis): AI generatyvinis dashboard'as — pagrindinė
  // pradžia. Klasikinis dashboard'as laikinai paliktas /pradzia adresu.
  { to: '/', label: 'Pradžia (AI)', icon: Sparkles },
  { to: '/pradzia', label: 'Pradžia', icon: LayoutDashboard },
  { to: '/prasymai', label: 'Prašymai', icon: FileText },
  { to: '/statistika', label: 'Statistika', icon: BarChart3 },
  { to: '/finansavimo-saltiniai', label: 'Finansavimo šaltiniai', icon: Coins },
  { to: '/biudzetas', label: 'Biudžetas', icon: Wallet },
  { to: '/projektai', label: 'Projektai', icon: Briefcase },
  { to: '/du', label: 'DU', icon: Banknote, payrollAccessOnly: true },
  { to: '/ataskaitos', label: 'Ataskaitos', icon: FileBarChart },
  { to: '/vartotojai', label: 'Vartotojai', icon: Users },
  { to: '/organizacijos', label: 'Organizacijos', icon: Building2, adminOnly: true },
  { to: '/klasifikatoriai', label: 'Klasifikatoriai', icon: Tags, classifiersAdminOnly: true },
];

export interface SidebarProps {
  onNavigate?: () => void;
  /**
   * Suskleistas (icon-rail) režimas — tik desktop'e. Mobile Sheet'as visada
   * rodo pilną variantą (props neperduodami).
   */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: SidebarProps): JSX.Element {
  const { user, logout } = useAuth();

  const fullName = user?.fullName ?? 'Naudotojas';
  const initials = user ? initialsFrom(fullName) : '??';
  const role = user ? roleLabel(user) : '';
  const showTenants = canManageTenants(user);
  const showClassifiers = canManageClassifiers(user);
  // SAUGUMAS (Iter 13): DU punktas matomas TIK kai canViewPayroll — specialistas
  // (org_user) niekada nemato net įrašo sidebar'e.
  const showPayroll = canViewPayroll(user);
  const navItems = PRIMARY_NAV.filter((i) => {
    if (i.adminOnly && !showTenants) return false;
    if (i.classifiersAdminOnly && !showClassifiers) return false;
    if (i.payrollAccessOnly && !showPayroll) return false;
    return true;
  });

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center gap-2 border-b border-border',
          collapsed ? 'justify-center px-2' : 'px-4',
        )}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground"
          title={collapsed ? `Finansai — ${user?.tenantName ?? 'Aplinkos ministerija'}` : undefined}
        >
          €
        </div>
        {!collapsed ? (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold leading-tight">Finansai</div>
              <div className="-mt-0.5 truncate text-[11px] text-muted-foreground">
                {user?.tenantName ?? 'Aplinkos ministerija'}
              </div>
            </div>
            {onToggleCollapse ? (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Suskleisti meniu"
                title="Suskleisti meniu"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {collapsed && onToggleCollapse ? (
        <div className="border-b border-border p-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Išskleisti meniu"
            title="Išskleisti meniu"
            className="flex w-full items-center justify-center rounded-md py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 text-sm">
        {navItems.map((item) => {
          if (item.disabled) {
            return (
              <div
                key={item.to}
                className={cn(
                  'flex items-center gap-2.5 rounded-md py-2 text-sm text-muted-foreground cursor-not-allowed opacity-60 min-h-[44px] md:min-h-0 md:py-2',
                  collapsed ? 'justify-center px-2' : 'px-3',
                )}
                aria-disabled="true"
                title={
                  collapsed
                    ? `${item.label} — bus įdiegta vėliau`
                    : 'Bus įdiegta vėlesnėje iteracijoje'
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed ? (
                  <>
                    <span className="flex-1">{item.label}</span>
                    <span className="text-[10px] uppercase">Greitai</span>
                  </>
                ) : null}
              </div>
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md py-2 transition-colors min-h-[44px] md:min-h-0 md:py-2',
                  collapsed ? 'justify-center px-2' : 'px-3',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-foreground hover:bg-muted',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed ? <span className="flex-1">{item.label}</span> : null}
            </NavLink>
          );
        })}

        <div className="mt-3 border-t border-border pt-2">
          <a
            href="/docs/"
            title={collapsed ? 'Dokumentacija' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md py-2 text-foreground transition-colors hover:bg-muted min-h-[44px] md:min-h-0 md:py-2',
              collapsed ? 'justify-center px-2' : 'px-3',
            )}
            onClick={onNavigate}
          >
            <FileText className="h-4 w-4 shrink-0" />
            {!collapsed ? (
              <>
                <span className="flex-1">Dokumentacija</span>
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </>
            ) : null}
          </a>
        </div>
      </nav>

      <div className="border-t border-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={collapsed ? `${fullName} — ${role}` : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                collapsed ? 'justify-center px-0' : 'px-2',
              )}
            >
              <Avatar className={cn(collapsed ? 'h-8 w-8' : 'h-9 w-9')}>
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              {!collapsed ? (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{fullName}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{role}</div>
                  </div>
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                </>
              ) : null}
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
