import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Bits";
import { useAuth, homeFor } from "@/lib/auth";

const NAV = [
  { to: "/book", label: "Explore Venues", id: "explore" },
  { to: "/#how-it-works", label: "How It Works", id: "how" },
  { to: "/contact?topic=owner", label: "For Venue Owners", id: "owners" },
];

function AuthButtons({ onClick }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (user)
    return (
      <>
        <Button variant="ghost" data-testid="nav-dashboard-btn" onClick={() => { onClick?.(); nav(homeFor(user.role)); }}>
          {user.role === "customer" ? "My Bookings" : "Dashboard"}
        </Button>
        <Button variant="outline" data-testid="nav-logout-btn" onClick={() => { onClick?.(); logout(); nav("/"); }}>Logout</Button>
      </>
    );
  return (
    <>
      <Button variant="ghost" asChild data-testid="nav-login-btn" onClick={onClick}><Link to="/login">Login</Link></Button>
      <Button asChild data-testid="nav-signup-btn" onClick={onClick}><Link to="/signup">Sign Up</Link></Button>
    </>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 bg-[#080808]/90 backdrop-blur border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Logo />
        <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-muted-foreground">
          {NAV.map((n) => (
            <NavLink key={n.id} to={n.to} data-testid={`nav-${n.id}-link`} className="hover:text-white transition-colors">{n.label}</NavLink>
          ))}
        </nav>
        <div className="hidden md:flex items-center gap-2"><AuthButtons /></div>
        <button className="md:hidden p-2" data-testid="nav-mobile-toggle" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <div className="md:hidden border-t border-border px-4 py-4 space-y-1 bg-[#080808]" data-testid="nav-mobile-menu">
          {NAV.map((n) => (
            <Link key={n.id} to={n.to} onClick={() => setOpen(false)} className="block py-2.5 font-semibold">{n.label}</Link>
          ))}
          <div className="flex gap-2 pt-3"><AuthButtons onClick={() => setOpen(false)} /></div>
        </div>
      )}
    </header>
  );
}

const FOOT = [["About", "/about"], ["Contact", "/contact"], ["Terms", "/terms"], ["Privacy", "/privacy"], ["Cancellation Policy", "/cancellation-policy"]];

export function Footer() {
  return (
    <footer className="border-t border-border mt-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col md:flex-row gap-6 md:items-center justify-between">
        <div>
          <Logo className="h-6" />
          <p className="text-xs text-muted-foreground mt-3">© {new Date().getFullYear()} NXTPLAY · Navsari, Gujarat, India</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {FOOT.map(([l, to]) => (
            <Link key={to} to={to} data-testid={`footer-${l.toLowerCase().replace(/ /g, "-")}-link`} className="hover:text-white">{l}</Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export default function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1"><Outlet /></main>
      <Footer />
    </div>
  );
}
