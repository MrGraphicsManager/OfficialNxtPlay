import { Link, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LayoutDashboard, CalendarDays, UserPlus, BadgeIndianRupee, ScanLine, CreditCard, SlidersHorizontal } from "lucide-react";
import DashLayout from "@/components/DashLayout";
import { EmptyState } from "@/components/Bits";
import { api } from "@/lib/api";
import { fmtDate, todayIST } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { ForcePasswordChange, SubscriptionGate, SubscriptionBanner } from "@/pages/owner/OwnerPlan";

const ITEMS = [
  { to: "/owner", label: "Overview", id: "owner-overview", icon: LayoutDashboard, end: true },
  { to: "/owner/bookings", label: "Bookings", id: "owner-bookings", icon: CalendarDays },
  { to: "/owner/walk-in", label: "Walk-in", id: "owner-walkin", icon: UserPlus },
  { to: "/owner/settings", label: "Venue settings", id: "owner-settings", icon: SlidersHorizontal },
  { to: "/owner/pricing", label: "Price approvals", id: "owner-pricing", icon: BadgeIndianRupee },
  { to: "/owner/scan", label: "Scan QR", id: "owner-scan", icon: ScanLine },
  { to: "/owner/subscription", label: "Subscription", id: "owner-subscription", icon: CreditCard },
];
const OPEN_WHEN_BLOCKED = ["/owner/subscription", "/owner/scan", "/owner/bookings"];

export const useOwner = () => useOutletContext();

export default function OwnerLayout() {
  const { data: venues, isLoading, refetch } = useQuery({ queryKey: ["owner-venues"], queryFn: async () => (await api.get("/owner/venues")).data });
  const [vid, setVid] = useState(localStorage.getItem("nxp_owner_venue") || "");
  const venue = venues?.find((v) => v.id === vid) || venues?.[0];
  const pick = (id) => { localStorage.setItem("nxp_owner_venue", id); setVid(id); };
  const { user, refresh } = useAuth();
  const loc = useLocation();
  const { data: subInfo, refetch: refetchSub } = useQuery({ queryKey: ["owner-subscription"], queryFn: async () => (await api.get("/subscriptions/mine")).data });
  const mustChange = user?.must_change_password || subInfo?.must_change_password;
  const blocked = subInfo && !subInfo.access.operational && !OPEN_WHEN_BLOCKED.includes(loc.pathname);
  const onSubPage = loc.pathname === "/owner/subscription";
  const ctx = { venue, reloadVenues: refetch, subInfo, reloadSub: refetchSub };
  const body = () => {
    if (isLoading || !subInfo) return <div className="h-40 surface animate-pulse" />;
    if (mustChange) return <ForcePasswordChange onDone={() => { refresh(); refetchSub(); }} />;
    if (blocked) return <SubscriptionGate info={subInfo} />;
    if (!venue && !onSubPage) return <EmptyState testId="owner-no-venue" title="No venue assigned yet" text="NXTPLAY admin will assign your venue shortly." />;
    return <><SubscriptionBanner info={subInfo} /><Outlet context={ctx} /></>;
  };

  const center = venue && (
    <div className="text-center min-w-0">
      {venues.length > 1 ? (
        <select className="bg-transparent font-display font-bold uppercase text-lg max-w-full truncate" value={venue.id} onChange={(e) => pick(e.target.value)} data-testid="owner-venue-select">
          {venues.map((v) => <option key={v.id} value={v.id} className="bg-card">{v.name}</option>)}
        </select>
      ) : <p className="font-display font-bold uppercase text-base sm:text-lg truncate" data-testid="owner-venue-name">{venue.name}</p>}
      <p className="text-[11px] text-muted-foreground hidden sm:block" data-testid="owner-current-date">{fmtDate(todayIST(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
    </div>
  );
  const right = (
    <Link to="/owner/scan" className="p-2 rounded-lg bg-primary hover:bg-secondary transition-colors" aria-label="Scan QR" data-testid="owner-header-scan-btn">
      <ScanLine className="w-5 h-5" />
    </Link>
  );
  return (
    <DashLayout items={ITEMS} headerCenter={center} headerRight={right} roleLabel="Venue owner">
      {body()}
    </DashLayout>
  );
}
