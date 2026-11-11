import { Link, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Building2, Users, CalendarDays, BadgeIndianRupee, TicketPercent, Wallet, Settings } from "lucide-react";
import DashLayout from "@/components/DashLayout";
import { Button } from "@/components/ui/button";
import { Stat, PageTitle } from "@/components/Bits";
import { api } from "@/lib/api";
import { inr } from "@/lib/format";

const ITEMS = [
  { to: "/admin", label: "Overview", id: "admin-overview", icon: LayoutDashboard, end: true },
  { to: "/admin/venues", label: "Venues", id: "admin-venues", icon: Building2 },
  { to: "/admin/owners", label: "Owners", id: "admin-owners", icon: Users },
  { to: "/admin/bookings", label: "Bookings & payments", id: "admin-bookings", icon: CalendarDays },
  { to: "/admin/pricing", label: "Pricing", id: "admin-pricing", icon: BadgeIndianRupee },
  { to: "/admin/coupons", label: "Coupons", id: "admin-coupons", icon: TicketPercent },
  { to: "/admin/finance", label: "Finance", id: "admin-finance", icon: Wallet },
  { to: "/admin/settings", label: "Settings", id: "admin-settings", icon: Settings },
];

export default function AdminLayout() {
  return <DashLayout items={ITEMS} roleLabel="Super admin"><Outlet /></DashLayout>;
}

export function AdminHome() {
  const { data: o } = useQuery({ queryKey: ["admin-overview"], queryFn: async () => (await api.get("/admin/overview")).data });
  return (
    <div>
      <PageTitle title="Command center" sub="Platform-wide snapshot" right={<Button asChild data-testid="admin-new-venue-btn"><Link to="/admin/venues/new">Create venue</Link></Button>} />
      {o && !o.payments_enabled && (
        <div className="surface border-amber-500/50 p-4 mb-6 text-sm text-amber-200" data-testid="admin-payments-warning">
          Razorpay is not configured. Online checkout is disabled until RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set. Cash walk-ins still work.
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat testId="admin-stat-venues" label="Venues" value={o ? `${o.active_venues}/${o.venues}` : "–"} hint="Active / total" />
        <Stat testId="admin-stat-owners" label="Owners" value={o?.owners ?? "–"} />
        <Stat testId="admin-stat-customers" label="Customers" value={o?.customers ?? "–"} />
        <Stat testId="admin-stat-bookings" label="Confirmed bookings" value={o?.confirmed_bookings ?? "–"} hint={o ? `${o.todays_bookings} today` : ""} />
        <Stat testId="admin-stat-online" label="Online collected" value={o ? inr(o.online_collected) : "–"} />
        <Stat testId="admin-stat-failed-refunds" label="Failed refunds" value={o?.failed_refunds ?? "–"} hint={o?.failed_refunds ? <Link to="/admin/bookings" className="text-red-300">Resolve</Link> : "All clear"} />
        <Stat testId="admin-stat-pending-prices" label="Pending price approvals" value={o?.pending_price_requests ?? "–"} />
      </div>
    </div>
  );
}
