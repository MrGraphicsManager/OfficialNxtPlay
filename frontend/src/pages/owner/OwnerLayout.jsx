import { Link, Outlet, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LayoutDashboard, CalendarDays, UserPlus, BadgeIndianRupee, ScanLine } from "lucide-react";
import DashLayout from "@/components/DashLayout";
import { EmptyState } from "@/components/Bits";
import { api } from "@/lib/api";
import { fmtDate, todayIST } from "@/lib/format";

const ITEMS = [
  { to: "/owner", label: "Overview", id: "owner-overview", icon: LayoutDashboard, end: true },
  { to: "/owner/bookings", label: "Bookings", id: "owner-bookings", icon: CalendarDays },
  { to: "/owner/walk-in", label: "Walk-in", id: "owner-walkin", icon: UserPlus },
  { to: "/owner/pricing", label: "Price approvals", id: "owner-pricing", icon: BadgeIndianRupee },
  { to: "/owner/scan", label: "Scan QR", id: "owner-scan", icon: ScanLine },
];

export const useOwner = () => useOutletContext();

export default function OwnerLayout() {
  const { data: venues, isLoading, refetch } = useQuery({ queryKey: ["owner-venues"], queryFn: async () => (await api.get("/owner/venues")).data });
  const [vid, setVid] = useState(localStorage.getItem("nxp_owner_venue") || "");
  const venue = venues?.find((v) => v.id === vid) || venues?.[0];
  const pick = (id) => { localStorage.setItem("nxp_owner_venue", id); setVid(id); };

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
      {isLoading ? <div className="h-40 surface animate-pulse" /> : !venue ? (
        <EmptyState testId="owner-no-venue" title="No venue assigned yet" text="NXTPLAY admin will assign your venue shortly." />
      ) : <Outlet context={{ venue, reloadVenues: refetch }} />}
    </DashLayout>
  );
}
