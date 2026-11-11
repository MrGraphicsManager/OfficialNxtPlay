import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, StatusBadge } from "@/components/Bits";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { inr, fmtDate, hmTo12 } from "@/lib/format";

export function CustomerTabs() {
  const items = [["/dashboard", "Dashboard"], ["/my-bookings", "My Bookings"], ["/profile", "Profile"]];
  return (
    <div className="flex gap-2 mb-8 overflow-x-auto no-scrollbar">
      {items.map(([to, l]) => (
        <NavLink key={to} to={to} data-testid={`cust-tab-${l.toLowerCase().replace(/ /g, "-")}`}
          className={({ isActive }) => `px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap ${isActive ? "bg-primary" : "bg-card text-muted-foreground hover:text-white"}`}>{l}</NavLink>
      ))}
    </div>
  );
}

const useMyBookings = () => useQuery({ queryKey: ["my-bookings"], queryFn: async () => (await api.get("/bookings/mine")).data });

export const BookingRow = ({ b }) => (
  <Link to={`/bookings/${b.id}`} className="surface p-4 sm:p-5 flex items-center justify-between gap-4 lift" data-testid={`booking-row-${b.code}`}>
    <div className="min-w-0">
      <p className="font-display font-bold text-xl uppercase truncate">{b.venue_name}</p>
      <p className="text-sm text-muted-foreground">{b.court_name} · {b.sport_name}</p>
      <p className="text-sm mt-1 flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-secondary" />{fmtDate(b.date)} · {hmTo12(b.start_time)} – {hmTo12(b.end_time)}</p>
    </div>
    <div className="text-right shrink-0 space-y-1">
      <StatusBadge status={b.checked_in_at ? "checked_in" : b.status} label={b.checked_in_at ? "Checked in" : undefined} />
      <p className="font-semibold">{inr(b.final_amount)}</p>
    </div>
  </Link>
);

const List = ({ items, empty }) =>
  items.length === 0 ? <EmptyState title={empty} action={<Button asChild><Link to="/venues">Find a venue</Link></Button>} /> : <div className="space-y-3">{items.map((b) => <BookingRow key={b.id} b={b} />)}</div>;

export function MyBookings() {
  const { data = [], isLoading } = useMyBookings();
  const upcoming = data.filter((b) => b.is_upcoming).reverse();
  const past = data.filter((b) => b.status === "confirmed" && !b.is_upcoming);
  const cancelled = data.filter((b) => b.status === "cancelled");
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <CustomerTabs />
      <h1 className="headline text-5xl mb-6">My bookings</h1>
      {isLoading ? <div className="h-40 surface animate-pulse" /> : (
        <Tabs defaultValue="upcoming">
          <TabsList className="mb-4" data-testid="bookings-tabs">
            <TabsTrigger value="upcoming" data-testid="tab-upcoming">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past" data-testid="tab-past">Past ({past.length})</TabsTrigger>
            <TabsTrigger value="cancelled" data-testid="tab-cancelled">Cancelled ({cancelled.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming"><List items={upcoming} empty="No upcoming games" /></TabsContent>
          <TabsContent value="past"><List items={past} empty="No past games yet" /></TabsContent>
          <TabsContent value="cancelled"><List items={cancelled} empty="No cancellations" /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export function CustomerDashboard() {
  const { user } = useAuth();
  const { data = [] } = useMyBookings();
  const upcoming = data.filter((b) => b.is_upcoming).reverse();
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <CustomerTabs />
      <h1 className="headline text-5xl" data-testid="customer-greeting">Hey {user?.name?.split(" ")[0]}, ready to play?</h1>
      <div className="grid grid-cols-3 gap-3 my-8">
        <div className="surface p-4"><p className="text-xs text-muted-foreground uppercase">Upcoming</p><p className="font-display text-3xl font-bold" data-testid="stat-upcoming">{upcoming.length}</p></div>
        <div className="surface p-4"><p className="text-xs text-muted-foreground uppercase">Played</p><p className="font-display text-3xl font-bold">{data.filter((b) => b.status === "confirmed" && !b.is_upcoming).length}</p></div>
        <div className="surface p-4"><p className="text-xs text-muted-foreground uppercase">Cancelled</p><p className="font-display text-3xl font-bold">{data.filter((b) => b.status === "cancelled").length}</p></div>
      </div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="headline text-3xl">Next up</h2>
        <Button asChild data-testid="dashboard-book-btn"><Link to="/venues">Book a slot</Link></Button>
      </div>
      <List items={upcoming.slice(0, 3)} empty="No upcoming games" />
    </div>
  );
}
