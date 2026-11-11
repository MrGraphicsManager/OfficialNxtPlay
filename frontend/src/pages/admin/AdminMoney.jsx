import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageTitle, StatusBadge, Table, Td, Field, NativeSelect, Stat } from "@/components/Bits";
import { useAdminList } from "@/pages/admin/AdminVenues";
import { api, errMsg } from "@/lib/api";
import { inr, fmtDate, fmtDateTime, todayIST, addDays } from "@/lib/format";

const blankCoupon = () => ({ code: "", discount_type: "percent", discount_value: "", max_discount: "", min_amount: 0, start_date: todayIST(), expiry_date: addDays(todayIST(), 30), usage_limit: 0, active: true });

export function AdminCoupons() {
  const { data = [], refetch } = useAdminList("coupons");
  const [edit, setEdit] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    const body = { ...edit, discount_value: Number(edit.discount_value), max_discount: edit.max_discount ? Number(edit.max_discount) : null, min_amount: Number(edit.min_amount || 0), usage_limit: Number(edit.usage_limit || 0) };
    try {
      if (edit.id) await api.put(`/admin/coupons/${edit.id}`, body);
      else await api.post("/admin/coupons", body);
      toast.success("Coupon saved");
      setEdit(null);
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });
  return (
    <div>
      <PageTitle title="Coupons" right={<Button onClick={() => setEdit(blankCoupon())} data-testid="coupon-new-btn">New coupon</Button>} />
      <Table testId="admin-coupons-table" cols={["Code", "Discount", "Min amount", "Valid", "Used", "Status", ""]}
        rows={data.map((c) => (
          <tr key={c.id} className="border-b border-border last:border-0" data-testid={`coupon-row-${c.code}`}>
            <Td className="font-pixel text-xs text-secondary">{c.code}</Td>
            <Td>{c.discount_type === "percent" ? `${c.discount_value}%${c.max_discount ? ` (max ${inr(c.max_discount)})` : ""}` : inr(c.discount_value)}</Td>
            <Td>{inr(c.min_amount)}</Td><Td>{fmtDate(c.start_date, { day: "numeric", month: "short" })} – {fmtDate(c.expiry_date, { day: "numeric", month: "short", year: "numeric" })}</Td>
            <Td>{c.used_count}{c.usage_limit ? ` / ${c.usage_limit}` : ""}</Td><Td><StatusBadge status={c.active ? "active" : "inactive"} /></Td>
            <Td><Button size="sm" variant="outline" onClick={() => setEdit({ ...c, max_discount: c.max_discount ?? "" })} data-testid={`coupon-edit-${c.code}`}>Edit</Button></Td>
          </tr>
        ))} />
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="bg-card max-w-lg">
          <DialogHeader><DialogTitle className="headline text-3xl">{edit?.id ? "Edit coupon" : "New coupon"}</DialogTitle></DialogHeader>
          {edit && (
            <form onSubmit={save} className="grid grid-cols-2 gap-3" data-testid="coupon-form">
              <Field label="Code"><input className="field uppercase" required disabled={!!edit.id} value={edit.code} onChange={set("code")} data-testid="coupon-code-input" /></Field>
              <Field label="Type"><NativeSelect testId="coupon-type-select" value={edit.discount_type} onChange={(v) => setEdit({ ...edit, discount_type: v })} options={[{ value: "percent", label: "Percent %" }, { value: "flat", label: "Flat ₹" }]} /></Field>
              <Field label="Value"><input type="number" min={1} required className="field" value={edit.discount_value} onChange={set("discount_value")} data-testid="coupon-value-input" /></Field>
              <Field label="Max discount ₹"><input type="number" min={0} className="field" value={edit.max_discount} onChange={set("max_discount")} data-testid="coupon-max-input" /></Field>
              <Field label="Min booking ₹"><input type="number" min={0} className="field" value={edit.min_amount} onChange={set("min_amount")} data-testid="coupon-min-input" /></Field>
              <Field label="Usage limit (0 = ∞)"><input type="number" min={0} className="field" value={edit.usage_limit} onChange={set("usage_limit")} data-testid="coupon-limit-input" /></Field>
              <Field label="Start date"><input type="date" className="field" value={edit.start_date} onChange={set("start_date")} data-testid="coupon-start-input" /></Field>
              <Field label="Expiry date"><input type="date" className="field" value={edit.expiry_date} onChange={set("expiry_date")} data-testid="coupon-expiry-input" /></Field>
              <label className="flex items-center gap-2 text-sm"><Switch checked={edit.active} onCheckedChange={(v) => setEdit({ ...edit, active: v })} data-testid="coupon-active-switch" />Active</label>
              <Button className="col-span-2" data-testid="coupon-save-btn">Save coupon</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AdminFinance() {
  const { data, refetch } = useAdminList("finance");
  const [settle, setSettle] = useState(null);
  const [ref, setRef] = useState("");
  if (!data) return <div className="h-40 surface animate-pulse" />;
  const t = data.totals;
  const record = async () => {
    try {
      await api.post("/admin/settlements", { venue_id: settle.venue_id, reference: ref });
      toast.success("Settlement recorded");
      setSettle(null);
      setRef("");
      refetch();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="space-y-8">
      <PageTitle title="Finance" sub={`Platform commission: ${data.commission_pct}% on online bookings. Settlements are recorded manually.`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat testId="fin-online" label="Online collected" value={inr(t.collected)} />
        <Stat testId="fin-refunded" label="Refunded" value={inr(t.refunded)} />
        <Stat testId="fin-commission" label="Platform commission" value={inr(t.platform_fee)} />
        <Stat testId="fin-venue-earnings" label="Venue earnings" value={inr(t.payable)} />
        <Stat testId="fin-settled" label="Settled" value={inr(t.settled)} />
        <Stat testId="fin-outstanding" label="Outstanding" value={inr(t.outstanding)} />
        <Stat testId="fin-cash" label="Cash walk-ins (venue-collected)" value={inr(t.cash_total)} hint="Not platform revenue" />
      </div>
      <div>
        <h2 className="headline text-3xl mb-3">Payable per venue</h2>
        <Table testId="fin-venues-table" cols={["Venue", "Online", "Refunded", "Fee", "Payable", "Settled", "Outstanding", "Cash", ""]}
          rows={data.venues.map((v) => (
            <tr key={v.venue_id} className="border-b border-border last:border-0">
              <Td className="font-semibold">{v.venue_name}</Td><Td>{inr(v.collected)}</Td><Td>{inr(v.refunded)}</Td><Td>{inr(v.platform_fee)}</Td>
              <Td>{inr(v.payable)}</Td><Td>{inr(v.settled)}</Td><Td className="text-amber-300 font-semibold">{inr(v.outstanding)}</Td><Td>{inr(v.cash_total)}</Td>
              <Td>{v.outstanding > 0 && <Button size="sm" onClick={() => setSettle(v)} data-testid={`fin-settle-${v.venue_id}`}>Record settlement</Button>}</Td>
            </tr>
          ))} />
      </div>
      <div>
        <h2 className="headline text-3xl mb-3">Settlement ledger</h2>
        <Table testId="fin-ledger-table" cols={["Booking", "Venue", "Date", "Gross", "Discount", "Refund", "Platform fee", "Net payable", "Settlement", "Settled on"]}
          rows={data.ledger.map((r) => (
            <tr key={r.booking_id} className="border-b border-border last:border-0">
              <Td className="font-pixel text-xs text-secondary">{r.booking_code}</Td><Td>{r.venue_name}</Td><Td>{fmtDate(r.date, { day: "numeric", month: "short" })}</Td>
              <Td>{inr(r.gross_amount)}</Td><Td>{inr(r.discount)}</Td><Td>{inr(r.refund)}{r.refund_status && r.refund_status !== "processed" && <span className="block text-[10px] text-amber-300">refund {r.refund_status}</span>}</Td>
              <Td>{inr(r.platform_fee)}</Td><Td className="font-semibold">{inr(r.net_venue_payable)}</Td><Td><StatusBadge status={r.settlement_status} /></Td><Td>{fmtDateTime(r.settlement_date)}</Td>
            </tr>
          ))} />
      </div>
      <div>
        <h2 className="headline text-3xl mb-3">Settlements</h2>
        <Table testId="fin-settlements-table" cols={["Venue", "Amount", "Bookings", "Reference", "Recorded"]}
          rows={data.settlements.map((s) => (
            <tr key={s.id} className="border-b border-border last:border-0"><Td>{s.venue_name}</Td><Td>{inr(s.amount)}</Td><Td>{s.booking_count}</Td><Td>{s.reference}</Td><Td>{fmtDateTime(s.created_at)}</Td></tr>
          ))} />
      </div>
      <Dialog open={!!settle} onOpenChange={(o) => !o && setSettle(null)}>
        <DialogContent className="bg-card max-w-sm">
          <DialogHeader><DialogTitle>Settle {inr(settle?.outstanding)} to {settle?.venue_name}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Record a payout you've already made (bank transfer / UPI). No money is moved by NXTPLAY.</p>
          <input className="field" placeholder="Transfer reference / UTR" value={ref} onChange={(e) => setRef(e.target.value)} data-testid="fin-settle-ref" />
          <Button disabled={ref.length < 2} onClick={record} data-testid="fin-settle-confirm">Record settlement</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NameList({ kind, label }) {
  const { data = [], refetch } = useAdminList(kind);
  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const add = async () => {
    try {
      await api.post(`/admin/${kind}`, { name, state: state || null, active: true });
      setName("");
      setState("");
      refetch();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const toggle = async (it) => {
    await api.patch(`/admin/${kind}/${it.id}`, { name: it.name, state: it.state, active: !it.active });
    refetch();
  };
  return (
    <div className="surface p-5">
      <h3 className="headline text-2xl mb-3">{label}</h3>
      <div className="space-y-2 mb-4">
        {data.map((it) => (
          <div key={it.id} className="flex items-center justify-between bg-background rounded-lg px-3 py-2" data-testid={`${kind}-item-${it.name}`}>
            <span>{it.name}{it.state && <span className="text-muted-foreground text-sm">, {it.state}</span>}</span>
            <Switch checked={it.active} onCheckedChange={() => toggle(it)} />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="field" placeholder={`Add ${kind === "cities" ? "city" : "sport"}`} value={name} onChange={(e) => setName(e.target.value)} data-testid={`${kind}-new-name`} />
        {kind === "cities" && <input className="field" placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />}
        <Button disabled={name.length < 2} onClick={add} data-testid={`${kind}-add-btn`}>Add</Button>
      </div>
    </div>
  );
}

export function AdminSettings() {
  const { data } = useAdminList("settings");
  const [s, setS] = useState(null);
  useEffect(() => {
    if (data) setS(data);
  }, [data]);
  const save = async () => {
    try {
      await api.put("/admin/settings", { commission_pct: Number(s.commission_pct), show_demo: s.show_demo });
      toast.success("Settings saved");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="space-y-6 max-w-4xl">
      <PageTitle title="Settings" />
      {s && (
        <div className="surface p-5 grid sm:grid-cols-3 gap-4 items-end" data-testid="settings-form">
          <Field label="Platform commission %" hint="Applies to new online bookings"><input type="number" min={0} max={50} step="0.5" className="field" value={s.commission_pct} onChange={(e) => setS({ ...s, commission_pct: e.target.value })} data-testid="settings-commission-input" /></Field>
          <label className="flex items-center gap-2 text-sm h-11"><Switch checked={s.show_demo} onCheckedChange={(v) => setS({ ...s, show_demo: v })} data-testid="settings-show-demo-switch" />Show demo venues publicly</label>
          <Button onClick={save} data-testid="settings-save-btn">Save settings</Button>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-6">
        <NameList kind="cities" label="Cities" />
        <NameList kind="sports" label="Sports" />
      </div>
    </div>
  );
}
