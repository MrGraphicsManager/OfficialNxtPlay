import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageTitle, StatusBadge, Table, Td, Field, NativeSelect } from "@/components/Bits";
import { useAdminList } from "@/pages/admin/AdminVenues";
import { api, errMsg } from "@/lib/api";
import { inr, fmtDate, hmTo12, fmtDateTime, todayIST } from "@/lib/format";

const call = async (fn, ok) => {
  try {
    const r = await fn();
    if (ok) toast.success(ok);
    return r;
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
};

export function AdminOwners() {
  const { data = [], refetch } = useAdminList("owners");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", mobile: "", password: "" });
  const [pwFor, setPwFor] = useState(null);
  const [pw, setPw] = useState("");
  const create = async (e) => {
    e.preventDefault();
    if (await call(() => api.post("/admin/owners", f), "Owner account created")) {
      setOpen(false);
      setF({ name: "", email: "", mobile: "", password: "" });
      refetch();
    }
  };
  return (
    <div>
      <PageTitle title="Venue owners" sub="Owners cannot self-register. Assign venues from the venue page." right={<Button onClick={() => setOpen(true)} data-testid="owner-create-open-btn">Add owner</Button>} />
      <Table testId="admin-owners-table" cols={["Name", "Email", "Mobile", "Venues", "Active", ""]}
        rows={data.map((o) => (
          <tr key={o.id} className="border-b border-border last:border-0" data-testid={`admin-owner-row-${o.id}`}>
            <Td className="font-semibold">{o.name}</Td><Td>{o.email}</Td><Td>{o.mobile}</Td><Td>{o.venues.join(", ") || "—"}</Td>
            <Td><Switch checked={o.active} onCheckedChange={async (v) => { await call(() => api.patch(`/admin/owners/${o.id}`, { active: v })); refetch(); }} data-testid={`owner-active-${o.id}`} /></Td>
            <Td><Button size="sm" variant="outline" onClick={() => setPwFor(o)} data-testid={`owner-reset-pw-${o.id}`}>Reset password</Button></Td>
          </tr>
        ))} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card max-w-md">
          <DialogHeader><DialogTitle className="headline text-3xl">New owner</DialogTitle></DialogHeader>
          <form onSubmit={create} className="space-y-3" data-testid="owner-create-form">
            {[["name", "Full name", "text"], ["email", "Email (login)", "email"], ["mobile", "Mobile", "tel"], ["password", "Temporary password", "password"]].map(([k, l, t]) => (
              <Field key={k} label={l}><input className="field" type={t} required minLength={k === "password" ? 8 : 2} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`owner-create-${k}`} /></Field>
            ))}
            <Button className="w-full" data-testid="owner-create-submit">Create owner</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!pwFor} onOpenChange={(o) => !o && setPwFor(null)}>
        <DialogContent className="bg-card max-w-sm">
          <DialogHeader><DialogTitle>Reset password · {pwFor?.name}</DialogTitle></DialogHeader>
          <input className="field" type="password" minLength={8} placeholder="New password (min 8)" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="owner-new-password" />
          <Button disabled={pw.length < 8} data-testid="owner-new-password-save" onClick={async () => { if (await call(() => api.patch(`/admin/owners/${pwFor.id}`, { password: pw }), "Password updated")) { setPwFor(null); setPw(""); } }}>Save</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AdminBookings() {
  const { data: venues = [] } = useAdminList("venues");
  const [venue, setVenue] = useState("");
  const [status, setStatus] = useState("");
  const { data: bookings = [], refetch } = useAdminList(`bookings?${new URLSearchParams({ ...(venue && { venue_id: venue }), ...(status && { status }) })}`);
  const { data: payments = [] } = useAdminList("payments");
  const { data: refunds = [], refetch: rr } = useAdminList("refunds");
  return (
    <div>
      <PageTitle title="Bookings & payments" />
      <Tabs defaultValue="bookings">
        <TabsList className="mb-4">
          <TabsTrigger value="bookings" data-testid="admin-tab-bookings">Bookings</TabsTrigger>
          <TabsTrigger value="payments" data-testid="admin-tab-payments">Payments</TabsTrigger>
          <TabsTrigger value="refunds" data-testid="admin-tab-refunds">Refunds ({refunds.filter((r) => r.status === "failed").length} failed)</TabsTrigger>
        </TabsList>
        <TabsContent value="bookings">
          <div className="grid sm:grid-cols-2 gap-3 mb-4 max-w-xl">
            <NativeSelect testId="admin-bookings-venue" value={venue} onChange={setVenue} placeholder="All venues" options={venues.map((v) => ({ value: v.id, label: v.name }))} />
            <NativeSelect testId="admin-bookings-status" value={status} onChange={setStatus} placeholder="All statuses" options={["confirmed", "cancelled", "payment_failed", "expired"].map((s) => ({ value: s, label: s.replace("_", " ") }))} />
          </div>
          <Table testId="admin-bookings-table" cols={["Code", "Venue / court", "Customer", "Slot", "Method", "Amount", "Status", ""]}
            rows={bookings.map((b) => (
              <tr key={b.id} className="border-b border-border last:border-0" data-testid={`admin-booking-row-${b.code}`}>
                <Td className="font-pixel text-xs text-secondary">{b.code}</Td>
                <Td>{b.venue_name}<span className="block text-xs text-muted-foreground">{b.court_name}</span></Td>
                <Td>{b.customer_name}{b.source === "walkin" && <span className="block text-[10px] text-amber-300 uppercase">walk-in</span>}</Td>
                <Td>{fmtDate(b.date, { day: "numeric", month: "short" })} · {hmTo12(b.start_time)}–{hmTo12(b.end_time)}</Td>
                <Td>{b.payment_method === "cash" ? "Cash" : "Razorpay"}</Td>
                <Td>{inr(b.final_amount)}{b.discount > 0 && <span className="block text-xs text-muted-foreground">−{inr(b.discount)} {b.coupon_code}</span>}</Td>
                <Td><StatusBadge status={b.status} />{b.refund_status && <span className="block mt-1"><StatusBadge status={b.refund_status} label={`refund ${b.refund_status}`} /></span>}</Td>
                <Td>{b.status === "confirmed" && <Button size="sm" variant="outline" data-testid={`admin-cancel-${b.code}`}
                  onClick={async () => { if (window.confirm(`Cancel ${b.code}${b.payment_method === "razorpay" ? " and refund" : ""}?`)) { await call(() => api.post(`/admin/bookings/${b.id}/cancel`), "Cancelled"); refetch(); rr(); } }}>Cancel</Button>}</Td>
              </tr>
            ))} />
        </TabsContent>
        <TabsContent value="payments">
          <Table testId="admin-payments-table" cols={["Booking", "Razorpay order", "Payment ID", "Method", "Amount", "Status", "Created"]}
            rows={payments.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <Td className="font-pixel text-xs text-secondary">{p.booking_code}</Td><Td className="text-xs">{p.razorpay_order_id}</Td>
                <Td className="text-xs">{p.razorpay_payment_id || "—"}</Td><Td className="capitalize">{p.method || "—"}</Td>
                <Td>{inr(p.amount)}</Td><Td><StatusBadge status={p.status} /></Td><Td>{fmtDateTime(p.created_at)}</Td>
              </tr>
            ))} />
        </TabsContent>
        <TabsContent value="refunds">
          <Table testId="admin-refunds-table" cols={["Booking", "Amount", "Razorpay refund", "Status", "Error", "Updated", ""]}
            rows={refunds.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0" data-testid={`admin-refund-row-${r.booking_code}`}>
                <Td className="font-pixel text-xs text-secondary">{r.booking_code}</Td><Td>{inr(r.amount)}</Td><Td className="text-xs">{r.razorpay_refund_id || "—"}</Td>
                <Td><StatusBadge status={r.status} /></Td><Td className="text-xs text-red-300 max-w-[220px] truncate">{r.error || ""}</Td><Td>{fmtDateTime(r.updated_at)}</Td>
                <Td className="space-x-2">
                  {r.razorpay_refund_id && <Button size="sm" variant="outline" onClick={async () => { await call(() => api.post(`/admin/refunds/${r.id}/refresh`), "Status refreshed"); rr(); }}>Refresh</Button>}
                  {r.status === "failed" && !r.razorpay_refund_id && <Button size="sm" onClick={async () => { await call(() => api.post(`/admin/refunds/${r.id}/retry`), "Retry sent"); rr(); }} data-testid={`refund-retry-${r.booking_code}`}>Retry</Button>}
                </Td>
              </tr>
            ))} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function AdminPricing() {
  const { data: venues = [] } = useAdminList("venues");
  const { data: reqs = [], refetch } = useAdminList("price-requests");
  const [vid, setVid] = useState("");
  const [courts, setCourts] = useState([]);
  const [f, setF] = useState({ court_id: "", proposed_price: "", effective_date: todayIST() });
  const pickVenue = async (id) => {
    setVid(id);
    setF({ ...f, court_id: "" });
    setCourts(id ? (await api.get(`/admin/venues/${id}`)).data.courts : []);
  };
  const court = courts.find((c) => c.id === f.court_id);
  const submit = async (e) => {
    e.preventDefault();
    if (await call(() => api.post("/admin/price-requests", { ...f, proposed_price: Number(f.proposed_price) }), "Proposal sent to owner")) {
      setF({ ...f, proposed_price: "" });
      refetch();
    }
  };
  return (
    <div>
      <PageTitle title="Public pricing" sub="Proposals stay pending until the venue owner approves. Current price remains active." />
      <form onSubmit={submit} className="surface p-5 grid sm:grid-cols-5 gap-3 items-end mb-6" data-testid="price-propose-form">
        <Field label="Venue"><NativeSelect testId="price-venue" value={vid} onChange={pickVenue} placeholder="Select" options={venues.map((v) => ({ value: v.id, label: v.name }))} /></Field>
        <Field label="Court"><NativeSelect testId="price-court" value={f.court_id} onChange={(v) => setF({ ...f, court_id: v })} placeholder="Select" options={courts.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label={`Proposed ₹${court ? ` (now ${inr(court.current_price)})` : ""}`}><input type="number" min={1} required className="field" value={f.proposed_price} onChange={(e) => setF({ ...f, proposed_price: e.target.value })} data-testid="price-amount" /></Field>
        <Field label="Effective date"><input type="date" min={todayIST()} required className="field" value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} data-testid="price-effective" /></Field>
        <Button disabled={!f.court_id} data-testid="price-submit-btn">Propose</Button>
      </form>
      <Table testId="admin-price-table" cols={["Venue", "Court", "Current", "Proposed", "Effective", "Status", "Created"]}
        rows={reqs.map((p) => (
          <tr key={p.id} className="border-b border-border last:border-0">
            <Td>{p.venue_name}</Td><Td>{p.court_name}</Td><Td>{inr(p.current_price)}</Td><Td className="text-secondary font-semibold">{inr(p.proposed_price)}</Td>
            <Td>{fmtDate(p.effective_date)}</Td><Td><StatusBadge status={p.status} /></Td><Td>{fmtDateTime(p.created_at)}</Td>
          </tr>
        ))} />
    </div>
  );
}
