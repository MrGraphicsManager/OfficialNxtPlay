import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, MapPin, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/Bits";
import CheckoutDialog from "@/components/CheckoutDialog";
import { api, imgUrl } from "@/lib/api";
import { useMeta } from "@/lib/meta";
import { useAuth } from "@/lib/auth";
import { inr, time12, todayIST, addDays, hmTo12, duration } from "@/lib/format";

export function nextSelection(sel, slot, slots) {
  const s = slot.start;
  if (sel.includes(s)) {
    if (s === sel[0]) return sel.slice(1);
    if (s === sel[sel.length - 1]) return sel.slice(0, -1);
    return [s];
  }
  if (!sel.length) return [s];
  const dur = slot.end - slot.start;
  const ok = (x) => slots.find((y) => y.start === x)?.status === "available";
  if (s === sel[sel.length - 1] + dur && ok(s)) return [...sel, s];
  if (s === sel[0] - dur && ok(s)) return [s, ...sel];
  return [s];
}

function DateStrip({ date, setDate }) {
  const today = todayIST();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1" data-testid="date-strip">
      {days.map((d) => {
        const dt = new Date(`${d}T00:00:00`);
        const active = d === date;
        return (
          <button key={d} onClick={() => setDate(d)} data-testid={`date-chip-${d}`}
            className={`shrink-0 w-16 py-2 rounded-lg border text-center transition-colors ${active ? "bg-primary border-primary" : "bg-card border-border hover:border-secondary"}`}>
            <span className="block text-[10px] uppercase text-white/70">{dt.toLocaleDateString("en-IN", { weekday: "short" })}</span>
            <span className="block font-display font-bold text-xl">{dt.getDate()}</span>
            <span className="block text-[10px] uppercase text-white/70">{dt.toLocaleDateString("en-IN", { month: "short" })}</span>
          </button>
        );
      })}
      <input type="date" className="field !w-40 shrink-0 !h-auto" value={date} min={today} onChange={(e) => e.target.value && setDate(e.target.value)} data-testid="date-picker-input" />
    </div>
  );
}

export default function VenueDetail() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { user } = useAuth();
  const { data: meta } = useMeta();
  const [date, setDateRaw] = useState(sp.get("date") || todayIST());
  const [courtId, setCourtId] = useState(null);
  const [sel, setSel] = useState([]);
  const [checkout, setCheckout] = useState(false);
  const setDate = (d) => { setDateRaw(d); setSel([]); };

  const { data: venue, isLoading, isError } = useQuery({ queryKey: ["venue", id], queryFn: async () => (await api.get(`/venues/${id}`)).data });
  const { data: slotData = [], refetch } = useQuery({
    queryKey: ["slots", id, date], enabled: !!venue, refetchInterval: 30000,
    queryFn: async () => (await api.get(`/venues/${id}/slots`, { params: { date } })).data,
  });

  const sportPref = sp.get("sport");
  const courts = venue?.courts || [];
  const court = courts.find((c) => c.id === courtId) || courts.find((c) => !sportPref || c.sport_id === sportPref) || courts[0];
  const slots = useMemo(() => slotData.find((s) => s.court_id === court?.id)?.slots || [], [slotData, court]);

  if (isLoading) return <div className="max-w-7xl mx-auto p-6"><div className="h-80 surface animate-pulse" /></div>;
  if (isError || !venue) return <div className="max-w-3xl mx-auto p-6"><EmptyState title="Venue not found" text="This venue is not available for booking." /></div>;

  const selected = slots.filter((s) => sel.includes(s.start));
  const total = selected.reduce((a, s) => a + s.price, 0);
  const proceed = () => {
    if (!user) return nav(`/login?next=${encodeURIComponent(loc.pathname + `?date=${date}`)}`);
    if (user.role !== "customer") return toast.error("Please use a customer account to book online.");
    setCheckout(true);
  };
  const cover = venue.image_ids?.[0] ? imgUrl(venue.image_ids[0]) : "/img/hero.jpg";

  return (
    <div className="pb-32">
      <section className="relative h-64 sm:h-80">
        <img src={cover} alt={venue.name} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/60 to-transparent" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 h-full flex flex-col justify-end pb-6">
          {venue.is_demo && <span className="pixel-badge !bg-amber-500 !text-black w-fit mb-3" data-testid="venue-demo-badge">Demo venue · not a real listing</span>}
          <h1 className="headline text-5xl sm:text-6xl" data-testid="venue-name">{venue.name}</h1>
          <p className="text-muted-foreground text-sm mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{venue.address}, {venue.city}</span>
            <span className="flex items-center gap-1" data-testid="venue-hours"><Clock className="w-4 h-4" />{hmTo12(venue.open_time)} – {hmTo12(venue.close_time)}</span>
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-[1fr_320px] gap-8 mt-8">
        <div className="space-y-8 min-w-0">
          {venue.image_ids?.length > 1 && (
            <div className="flex gap-3 overflow-x-auto no-scrollbar">
              {venue.image_ids.slice(1).map((i) => <img key={i} src={imgUrl(i)} alt="" className="h-28 w-44 object-cover rounded-lg shrink-0" />)}
            </div>
          )}
          <div>
            <h2 className="headline text-2xl mb-3">1. Choose a court</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="court-list">
              {courts.map((c) => (
                <button key={c.id} onClick={() => { setCourtId(c.id); setSel([]); }} data-testid={`court-option-${c.id}`}
                  className={`text-left p-4 rounded-xl border transition-colors ${court?.id === c.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-secondary"}`}>
                  <p className="font-display font-bold text-xl uppercase">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.sport_name} · {duration(c.slot_minutes)} slots</p>
                  <p className="text-sm font-semibold mt-1">{inr(c.price)} <span className="text-muted-foreground font-normal">/ slot</span></p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h2 className="headline text-2xl mb-3">2. Pick a date</h2>
            <DateStrip date={date} setDate={setDate} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="headline text-2xl">3. Select slots</h2>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-card border border-border inline-block" />Open</span>
                <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-primary inline-block" />Selected</span>
                <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-zinc-700 inline-block" />Booked</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1"><Info className="w-3.5 h-3.5" />Tap consecutive slots to book a longer session.</p>
            {slots.length === 0 ? <p className="text-muted-foreground text-sm">No slots for this court.</p> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2" data-testid="slot-grid">
                {slots.map((s) => {
                  const isSel = sel.includes(s.start);
                  const disabled = s.status !== "available";
                  return (
                    <button key={s.start} disabled={disabled} onClick={() => setSel(nextSelection(sel, s, slots))} data-testid={`slot-${s.start}`}
                      className={`py-3 px-2 rounded-lg border text-sm font-semibold transition-colors ${isSel ? "bg-primary border-primary text-white" : disabled ? "bg-zinc-800/60 border-transparent text-zinc-500 line-through cursor-not-allowed" : "bg-card border-border hover:border-secondary"}`}>
                      {time12(s.start)}
                      <span className="block text-[11px] font-normal opacity-70">{s.status === "booked" ? "Booked" : s.status === "past" ? "Passed" : inr(s.price)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <aside className="space-y-4">
          <div className="surface p-5">
            <h3 className="headline text-xl mb-2">Booking rules</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-line" data-testid="venue-rules">{venue.rules || "Arrive 10 minutes early. Follow venue staff instructions."}</p>
          </div>
          <div className="surface p-5 text-sm text-muted-foreground">
            <h3 className="headline text-xl mb-2 text-white">Cancellation</h3>
            Free cancellation up to 24 hours before your slot. Refunds go back to your original payment method.
          </div>
        </aside>
      </div>

      {selected.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-[#151515] border-t border-border" data-testid="selection-bar">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-sm sm:text-base" data-testid="selection-summary">{time12(selected[0].start)} – {time12(selected[selected.length - 1].end)} · {duration(selected[selected.length - 1].end - selected[0].start)}</p>
              <p className="text-xs text-muted-foreground">{court.name} · {selected.length} slot{selected.length > 1 ? "s" : ""}</p>
            </div>
            <div className="flex items-center gap-3">
              <p className="font-display font-bold text-2xl" data-testid="selection-total">{inr(total)}</p>
              <Button className="font-bold h-11" onClick={proceed} data-testid="proceed-checkout-btn">Checkout</Button>
            </div>
          </div>
        </div>
      )}
      <CheckoutDialog open={checkout} paymentsEnabled={meta?.payments_enabled}
        onClose={() => { setCheckout(false); refetch(); }}
        selection={selected.length ? { court_id: court.id, date, start_min: selected[0].start, end_min: selected[selected.length - 1].end } : null} />
    </div>
  );
}
