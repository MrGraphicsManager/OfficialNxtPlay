import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import WalkinTicket from "@/components/WalkinTicket";
import { Field, NativeSelect, PageTitle } from "@/components/Bits";
import { useOwner } from "@/pages/owner/OwnerLayout";
import { api, errMsg } from "@/lib/api";
import { payWithRazorpay } from "@/lib/razorpay";
import { inr, time12, todayIST } from "@/lib/format";

const hm = (m) => (m === 1440 ? "24:00" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const EMPTY = { customer_name: "", customer_mobile: "", payment_method: "cash", custom_price: "" };

export default function OwnerWalkin() {
  const { venue } = useOwner();
  const qc = useQueryClient();
  const courts = venue.courts.filter((c) => c.active);
  const [courtId, setCourtId] = useState(courts[0]?.id || "");
  const [date, setDate] = useState(todayIST());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState(null);

  const { data: slotData = [], refetch } = useQuery({
    queryKey: ["owner-slots", venue.id, date],
    queryFn: async () => (await api.get("/owner/slots", { params: { venue_id: venue.id, date } })).data,
  });
  const slots = slotData.find((s) => s.court_id === courtId)?.slots || [];
  const endOptions = useMemo(() => {
    const i = slots.findIndex((s) => String(s.start) === start);
    if (i < 0) return [];
    const out = [];
    for (let j = i; j < slots.length && slots[j].status === "available"; j++) out.push(slots[j]);
    return out;
  }, [slots, start]);
  const picked = endOptions.filter((s) => Number(end) >= s.end);
  const listPrice = picked.reduce((a, s) => a + s.price, 0);

  const reset = () => { setStart(""); setEnd(""); setF(EMPTY); refetch(); qc.invalidateQueries({ queryKey: ["owner-overview"] }); };
  const submit = async (e) => {
    e.preventDefault();
    if (!start || !end) return toast.error("Choose start and end time");
    setBusy(true);
    try {
      const body = { court_id: courtId, date, start_time: hm(Number(start)), end_time: hm(Number(end)), customer_name: f.customer_name,
        customer_mobile: f.customer_mobile, payment_method: f.payment_method,
        custom_price: f.payment_method === "cash" && f.custom_price !== "" ? Number(f.custom_price) : null };
      const { data } = await api.post("/owner/walkin", body);
      if (f.payment_method === "online") {
        await payWithRazorpay({ order: data.order, booking: data.booking, prefill: { name: f.customer_name, contact: f.customer_mobile }, description: "Walk-in booking" });
      }
      toast.success(`Walk-in booked: ${data.booking.code}`);
      setTicket(data.booking.id);
      reset();
    } catch (err) {
      toast.error(err.message && !err.response ? err.message : errMsg(err));
      refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageTitle title="Walk-in booking" sub="Offline bookings block the court exactly like online ones." />
      <form onSubmit={submit} className="surface p-6 space-y-5" data-testid="walkin-form">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Court"><NativeSelect testId="walkin-court-select" value={courtId} onChange={(v) => { setCourtId(v); setStart(""); setEnd(""); }} options={courts.map((c) => ({ value: c.id, label: `${c.name} · ${c.sport_name}` }))} /></Field>
          <Field label="Date"><input type="date" className="field" min={todayIST()} value={date} onChange={(e) => { setDate(e.target.value); setStart(""); setEnd(""); }} data-testid="walkin-date-input" /></Field>
          <Field label="Start time"><NativeSelect testId="walkin-start-select" value={start} onChange={(v) => { setStart(v); setEnd(""); }} placeholder="Select start"
            options={slots.filter((s) => s.status === "available").map((s) => ({ value: String(s.start), label: time12(s.start) }))} /></Field>
          <Field label="End time"><NativeSelect testId="walkin-end-select" value={end} onChange={setEnd} placeholder="Select end"
            options={endOptions.map((s) => ({ value: String(s.end), label: time12(s.end) }))} /></Field>
          <Field label="Customer name"><input className="field" required value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} data-testid="walkin-name-input" /></Field>
          <Field label="Customer mobile"><input className="field" required pattern="[0-9+ ]{10,15}" value={f.customer_mobile} onChange={(e) => setF({ ...f, customer_mobile: e.target.value })} data-testid="walkin-mobile-input" /></Field>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payment method</span>
          <div className="flex gap-2 mt-2">
            {["cash", "online"].map((m) => (
              <button type="button" key={m} onClick={() => setF({ ...f, payment_method: m })} data-testid={`walkin-pay-${m}`}
                className={`px-5 py-2.5 rounded-lg border font-semibold capitalize ${f.payment_method === m ? "bg-primary border-primary" : "border-border bg-background"}`}>{m}</button>
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-background p-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Public price for selection</p>
            <p className="font-display font-bold text-3xl" data-testid="walkin-list-price">{inr(listPrice)}</p>
          </div>
          {f.payment_method === "cash" && (
            <Field label="Negotiated price (optional)" hint="Doesn't change public prices">
              <input type="number" min={0} className="field !w-48" placeholder={String(listPrice)} value={f.custom_price} onChange={(e) => setF({ ...f, custom_price: e.target.value })} data-testid="walkin-custom-price-input" />
            </Field>
          )}
        </div>
        <Button className="h-11 font-bold" disabled={busy} data-testid="walkin-submit-btn">{busy ? "Saving…" : f.payment_method === "cash" ? "Record cash booking" : "Collect online payment"}</Button>
      </form>
      <Dialog open={!!ticket} onOpenChange={(o) => !o && setTicket(null)}>
        <DialogContent className="bg-card max-w-sm" data-testid="walkin-ticket-dialog">
          <DialogHeader><DialogTitle className="headline text-3xl">Booking confirmed</DialogTitle></DialogHeader>
          {ticket && <WalkinTicket bookingId={ticket} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
