import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Stat, PageTitle, StatusBadge, Table, Td, NativeSelect } from "@/components/Bits";
import { useOwner } from "@/pages/owner/OwnerLayout";
import WalkinTicket from "@/components/WalkinTicket";
import { api } from "@/lib/api";
import { inr, todayIST, hmTo12, fmtDate, fmtDateTime } from "@/lib/format";

const useBookings = (venueId, date, courtId) =>
  useQuery({
    queryKey: ["owner-bookings", venueId, date, courtId],
    queryFn: async () => (await api.get("/owner/bookings", { params: { venue_id: venueId, date: date || undefined, court_id: courtId || undefined } })).data,
  });

function BookingDialog({ b, onClose }) {
  if (!b) return null;
  const rows = [["Code", b.code], ["Customer", b.customer_name], ["Mobile", b.customer_mobile || "—"], ["Court", `${b.court_name} · ${b.sport_name}`],
    ["Date", fmtDate(b.date)], ["Time", `${hmTo12(b.start_time)} – ${hmTo12(b.end_time)}`], ["Source", b.source === "walkin" ? "Walk-in" : "Online"],
    ["Payment", b.payment_method === "cash" ? "Cash" : `Razorpay${b.paid_via ? ` (${b.paid_via})` : ""}`], ["Amount", inr(b.final_amount)],
    ["Checked in", b.checked_in_at ? fmtDateTime(b.checked_in_at) : "Not yet"]];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card max-w-md" data-testid="owner-booking-dialog">
        <DialogHeader><DialogTitle className="headline text-3xl">Booking details</DialogTitle></DialogHeader>
        <div className="text-sm">
          {rows.map(([l, v]) => <div key={l} className="flex justify-between py-2 border-b border-border last:border-0"><span className="text-muted-foreground">{l}</span><span className="font-semibold">{v}</span></div>)}
          <div className="pt-3"><StatusBadge status={b.status} /></div>
        </div>
        {b.source === "walkin" && <div className="border-t border-border pt-4"><WalkinTicket bookingId={b.id} /></div>}
      </DialogContent>
    </Dialog>
  );
}

export function BookingsTable({ items, testId }) {
  const [open, setOpen] = useState(null);
  return (
    <>
      <Table testId={testId} cols={["Code", "Customer", "Court", "Date", "Time", "Payment", "Amount", "Status"]} empty="No bookings found."
        rows={items.map((b) => (
          <tr key={b.id} className="border-b border-border last:border-0 hover:bg-accent/50 cursor-pointer" onClick={() => setOpen(b)} data-testid={`owner-booking-row-${b.code}`}>
            <Td className="font-pixel text-xs text-secondary">{b.code}</Td>
            <Td>{b.customer_name}{b.source === "walkin" && <span className="ml-2 text-[10px] uppercase text-amber-300">walk-in</span>}</Td>
            <Td>{b.court_name}</Td>
            <Td>{fmtDate(b.date, { day: "numeric", month: "short" })}</Td>
            <Td>{hmTo12(b.start_time)} – {hmTo12(b.end_time)}</Td>
            <Td>{b.payment_method === "cash" ? "Cash" : "Online"}</Td>
            <Td>{inr(b.final_amount)}</Td>
            <Td><StatusBadge status={b.checked_in_at ? "checked_in" : b.status} label={b.checked_in_at ? "Checked in" : undefined} /></Td>
          </tr>
        ))} />
      <BookingDialog b={open} onClose={() => setOpen(null)} />
    </>
  );
}

export function OwnerHome() {
  const { venue } = useOwner();
  const { data: o } = useQuery({ queryKey: ["owner-overview", venue.id], queryFn: async () => (await api.get("/owner/overview", { params: { venue_id: venue.id } })).data });
  const { data: today = [] } = useBookings(venue.id, todayIST());
  return (
    <div>
      <PageTitle title="Overview" sub="Today at your venue" right={<Button asChild data-testid="owner-add-walkin-btn"><Link to="/owner/walk-in">Add walk-in</Link></Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
        <Stat testId="owner-stat-today" label="Today's bookings" value={o?.todays_bookings ?? "–"} />
        <Stat testId="owner-stat-upcoming" label="Upcoming" value={o?.upcoming_bookings ?? "–"} />
        <Stat testId="owner-stat-available" label="Available slots" value={o?.available_slots ?? "–"} hint="Remaining today" />
        <Stat testId="owner-stat-occupied" label="Occupied slots" value={o?.occupied_slots ?? "–"} />
        <Stat testId="owner-stat-revenue" label="Today's revenue" value={o ? inr(o.todays_revenue) : "–"} hint={o ? `Cash ${inr(o.todays_cash)}` : ""} />
        <Stat testId="owner-stat-pending-prices" label="Price approvals" value={o?.pending_price_approvals ?? "–"} hint={o?.pending_price_approvals ? <Link className="text-secondary" to="/owner/pricing">Review</Link> : "None pending"} />
      </div>
      <h2 className="headline text-3xl mb-4">Today's bookings</h2>
      <BookingsTable items={today} testId="owner-today-table" />
    </div>
  );
}

export function OwnerBookings() {
  const { venue } = useOwner();
  const [date, setDate] = useState("");
  const [court, setCourt] = useState("");
  const { data = [] } = useBookings(venue.id, date, court);
  return (
    <div>
      <PageTitle title="Bookings" sub="All bookings for your venue" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} data-testid="owner-filter-date" />
        <NativeSelect testId="owner-filter-court" value={court} onChange={setCourt} placeholder="All courts" options={venue.courts.map((c) => ({ value: c.id, label: c.name }))} />
        <Button variant="outline" onClick={() => { setDate(""); setCourt(""); }} data-testid="owner-filter-clear">Clear filters</Button>
      </div>
      <BookingsTable items={data} testId="owner-bookings-table" />
    </div>
  );
}
