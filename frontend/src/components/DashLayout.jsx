import { NavLink, useNavigate } from "react-router-dom";
import { LogOut, UserCircle2 } from "lucide-react";
import { Logo } from "@/components/Bits";
import { useAuth } from "@/lib/auth";

export default function DashLayout({ items, children, headerCenter, headerRight, roleLabel }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-[#080808]/95 backdrop-blur border-b border-border">
        <div className="px-4 sm:px-6 h-16 flex items-center gap-3 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Logo className="h-6" />
            <span className="hidden sm:inline font-pixel text-[10px] text-secondary uppercase">{roleLabel}</span>
          </div>
          <div className="min-w-0 flex-1 flex justify-center">{headerCenter}</div>
          <div className="flex items-center gap-1 sm:gap-2">
            {headerRight}
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground px-2" data-testid="dash-profile">
              <UserCircle2 className="w-5 h-5" /> <span className="max-w-[140px] truncate">{user?.name}</span>
            </div>
            <button data-testid="dash-logout-btn" onClick={() => { logout(); nav("/login"); }} className="p-2 rounded-lg hover:bg-accent" aria-label="Logout">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
        <nav className="md:hidden flex gap-1 overflow-x-auto no-scrollbar px-3 pb-2">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} data-testid={`m-nav-${i.id}`}
              className={({ isActive }) => `px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${isActive ? "bg-primary text-white" : "text-muted-foreground bg-card"}`}>
              {i.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="flex">
        <aside className="hidden md:block w-60 shrink-0 border-r border-border min-h-[calc(100vh-4rem)] p-4 space-y-1">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} data-testid={`nav-${i.id}`}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${isActive ? "bg-primary text-white" : "text-muted-foreground hover:bg-accent hover:text-white"}`}>
              {i.icon && <i.icon className="w-4 h-4" />} {i.label}
            </NavLink>
          ))}
        </aside>
        <main className="flex-1 min-w-0 p-4 sm:p-8 fade-up">{children}</main>
      </div>
    </div>
  );
}
