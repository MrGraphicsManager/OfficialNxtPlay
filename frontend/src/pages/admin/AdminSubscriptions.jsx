import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, NativeSelect, PageTitle, StatusBadge, Table, Td } from "@/components/Bits";
import { api, errMsg } from "@/lib/api";
import { addDays, fmtDate, fmtDateTime, inr, todayIST } from "@/lib/format";

const PLANS = [{ value: "starter", label: "Starter · ₹399/month · up to 5 courts" }, { value: "growth", label: "Growth · ₹699/month · up to 10 courts" }];
const STATE = { legacy: "No plan (legacy access)", awaiting_plan: "Needs a plan", awaiting_authorization: "Awaiting authorization", active: "Active", cancelling: "Cancelling", grace: "Grace period", expired: "Expired" };
const day = (s) => (s ? fmtDate(s.slice(0, 10)) : "—");
const act = async (fn, ok) => { try { const r = await fn(); toast.success(ok); return r?.data ?? true; } catch (e) { toast.error(errMsg(e)); return null; } };
const PlanFields = ({ f, setF, prefix }) => (
  <>
    <Field label="Plan"><NativeSelect value={f.plan} onChange={(v) => setF({ ...f, plan: v })} options={PLANS} testId={`${prefix}-plan-select`} /></Field>
    <Field label="Start date"><input className="field" type="date" required value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} data-testid={`${prefix}-start-input`} /></Field>
    <Field label="Expiry date"><input className="field" type="date" required value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} data-testid={`${prefix}-expiry-input`} /></Field>
  </>
);
const blankPlan = () => ({ plan: "starter", start_date: todayIST(), expiry_date: addDays(todayIST(), 365) });

function Credentials({ creds, onClose }) {
  return (
    <Dialog open={!!creds} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card max-w-md" data-testid="credentials-dialog">
        <DialogHeader><DialogTitle className="headline text-3xl">Login credentials</DialogTitle></DialogHeader>
        {creds && <div className="space-y-3 text-sm">
          <p>Share this temporary password with the owner privately. It is shown only once and must be changed at first login.</p>
          <div className="flex items-center gap-2 bg-[#0f0f0f] border border-border p-3 rounded-md">
            <code className="flex-1 text-primary" data-testid="temp-password">{creds.temporary_password}</code>
            <button onClick={() => { navigator.clipboard.writeText(creds.temporary_password); toast.success("Copied"); }} aria-label="Copy" data-testid="copy-temp-password"><Copy className="w-4 h-4" /></button>
          </div>
          <p className={creds.email_sent ? "text-primary" : "text-red-400"} data-testid="invite-email-status">{creds.email_sent ? "Login instructions with a secure setup link were emailed to the owner." : "The email could not be sent. Share the login details manually."}</p>
        </div>}
      </DialogContent>
    </Dialog>
  );
}

function CreateOwner({ onCreated }) {
  const [f, setF] = useState({ name: "", email: "", mobile: "", ...blankPlan() });
  const [busy, setBusy] = useState(false);
  const b = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await act(() => api.post("/subscriptions/admin/owners", f), "Turf owner created");
    setBusy(false);
    if (r) { setF({ name: "", email: "", mobile: "", ...blankPlan() }); onCreated(r); }
  };
  return (
    <form onSubmit={submit} className="surface p-5 grid sm:grid-cols-3 gap-4" data-testid="create-owner-form">
      <Field label="Owner name"><input className="field" required minLength={2} {...b("name")} data-testid="co-name-input" /></Field>
      <Field label="Owner email"><input className="field" type="email" required {...b("email")} data-testid="co-email-input" /></Field>
      <Field label="Mobile"><input className="field" required minLength={10} {...b("mobile")} data-testid="co-mobile-input" /></Field>
      <PlanFields f={f} setF={setF} prefix="co" />
      <div className="sm:col-span-3"><Button disabled={busy} className="font-bold" data-testid="co-submit-btn">{busy ? "Creating…" : "Create owner & send login"}</Button></div>
    </form>
  );
}

function Manage({ ownerId, onClose, onChanged, onCreds }) {
  const { data: d, refetch } = useQuery({ queryKey: ["sub-owner", ownerId], enabled: !!ownerId, queryFn: async () => (await api.get(`/subscriptions/admin/owners/${ownerId}`)).data });
  const [plan, setPlan] = useState(null);
  const [renew, setRenew] = useState({ paid_until: "", note: "" });
  const done = () => { refetch(); onChanged(); };
  const sub = d?.subscription;
  const p = plan || (sub ? { plan: sub.plan, start_date: sub.start_date, expiry_date: sub.expiry_date } : blankPlan());
  return (
    <Dialog open={!!ownerId} onOpenChange={(o) => { if (!o) { setPlan(null); onClose(); } }}>
      <DialogContent className="bg-card max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="manage-owner-dialog">
        <DialogHeader><DialogTitle className="headline text-3xl">{d?.owner?.name || "Owner"}</DialogTitle></DialogHeader>
        {d && <div className="space-y-6 text-sm">
          <div className="grid sm:grid-cols-3 gap-3">
            <p><span className="text-muted-foreground">Email</span><br />{d.owner.email}</p>
            <p><span className="text-muted-foreground">Mobile</span><br />{d.owner.mobile || "—"}</p>
            <p><span className="text-muted-foreground">Venues</span><br />{d.venues.map((v) => v.name).join(", ") || "None yet"}</p>
            <p><span className="text-muted-foreground">Access</span><br /><span data-testid="manage-state">{STATE[d.access.state]}</span></p>
            <p><span className="text-muted-foreground">Paid until</span><br />{day(d.access.paid_until)}</p>
            <p><span className="text-muted-foreground">Razorpay subscription</span><br /><code className="text-xs">{d.provider_subscription_id || "—"}</code></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" data-testid="manage-toggle-active-btn" onClick={() => act(() => api.patch(`/admin/owners/${ownerId}`, { active: !d.owner.active }), d.owner.active ? "Owner suspended" : "Owner activated").then(done)}>{d.owner.active ? "Suspend account" : "Activate account"}</Button>
            <Button variant="outline" data-testid="manage-resend-invite-btn" onClick={() => act(() => api.post(`/subscriptions/admin/owners/${ownerId}/resend-invite`), "New login issued").then((r) => { if (r) { onCreds(r); done(); } })}>New temporary login</Button>
            {sub?.has_provider_subscription && <Button variant="outline" data-testid="manage-sync-btn" onClick={() => act(() => api.post(`/subscriptions/admin/owners/${ownerId}/sync`), "Synced with Razorpay").then(done)}>Sync with Razorpay</Button>}
            {sub && sub.status !== "cancelled" && <Button variant="outline" data-testid="manage-cancel-btn" onClick={() => window.confirm("Cancel auto-pay? Access continues until the paid period ends.") && act(() => api.post(`/subscriptions/admin/owners/${ownerId}/cancel`), "Subscription cancelled").then(done)}>Cancel auto-pay</Button>}
          </div>
          <form className="grid sm:grid-cols-4 gap-3 items-end border-t border-border pt-4" onSubmit={(e) => {
            e.preventDefault();
            if (d.access.state === "legacy" && !window.confirm("This owner currently has free legacy access. After assigning a plan, their dashboard and public venue listing pause until they authorize the plan (or you record a manual renewal). Continue?")) return;
            act(() => api.post("/subscriptions/admin/assign", { owner_id: ownerId, ...p }), sub ? "Plan updated" : "Plan assigned").then(done);
          }}>
            <PlanFields f={p} setF={setPlan} prefix="manage" />
            <Button data-testid="manage-assign-btn">{sub ? "Change plan / dates" : "Assign plan"}</Button>
          </form>
          {sub && <form className="grid sm:grid-cols-[160px_1fr_auto] gap-3 items-end" onSubmit={(e) => { e.preventDefault(); act(() => api.post(`/subscriptions/admin/owners/${ownerId}/manual-renewal`, renew), "Manual renewal recorded").then(done); }}>
            <Field label="Manual paid-until"><input className="field" type="date" required value={renew.paid_until} onChange={(e) => setRenew({ ...renew, paid_until: e.target.value })} data-testid="manual-renew-date" /></Field>
            <Field label="Reason / reference"><input className="field" required minLength={3} value={renew.note} onChange={(e) => setRenew({ ...renew, note: e.target.value })} placeholder="e.g. offline payment, custom plan" data-testid="manual-renew-note" /></Field>
            <Button variant="outline" data-testid="manual-renew-btn">Record renewal</Button>
          </form>}
          <div><h4 className="headline text-xl mb-2">Payments</h4>
            <Table testId="manage-payments-table" cols={["Date", "Amount", "Status", "Reference", "Note"]} empty="No payments yet." rows={d.payments.map((x) => (
              <tr key={x.id} className="border-t border-border"><Td>{fmtDateTime(x.created_at)}</Td><Td>{inr(x.amount)}</Td><Td><StatusBadge status={x.status} /></Td><Td><code className="text-xs">{x.payment_ref}</code></Td><Td>{x.error || ""}</Td></tr>))} /></div>
          <div><h4 className="headline text-xl mb-2">History & audit log</h4>
            <div className="space-y-1 max-h-60 overflow-y-auto" data-testid="manage-history">
              {[...d.history.map((h) => ({ ...h, kind: "sub" })), ...d.audit.map((a) => ({ ...a, kind: "audit" }))].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((h) => (
                <p key={h.id} className="text-xs"><span className="text-muted-foreground">{fmtDateTime(h.created_at)}</span> · <span className="text-primary">{h.action}</span> {h.details && Object.keys(h.details).length ? <span className="text-muted-foreground">{JSON.stringify(h.details)}</span> : null}</p>))}
            </div></div>
        </div>}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminSubscriptions() {
  const { data = [], refetch } = useQuery({ queryKey: ["admin-subs"], queryFn: async () => (await api.get("/subscriptions/admin/owners")).data });
  const [manage, setManage] = useState(null);
  const [creds, setCreds] = useState(null);
  return (
    <div className="space-y-6">
      <PageTitle title="Turf owners & subscriptions" sub="Create owner accounts, assign plans and track recurring payments. 0% booking commission." />
      <CreateOwner onCreated={(r) => { setCreds(r); refetch(); }} />
      <Table testId="subs-table" cols={["Owner", "Plan", "Access", "Paid until", "Venues", "Account", ""]} empty="No turf owners yet." rows={data.map((r) => (
        <tr key={r.owner.id} className="border-t border-border" data-testid={`subs-row-${r.owner.email}`}>
          <Td><p className="font-semibold">{r.owner.name}</p><p className="text-xs text-muted-foreground">{r.owner.email}</p></Td>
          <Td className="capitalize">{r.subscription ? `${r.subscription.plan} · ${inr(r.subscription.amount)}` : "—"}</Td>
          <Td><span className={r.access.operational ? "text-primary" : "text-red-400"}>{STATE[r.access.state]}</span></Td>
          <Td>{day(r.access.paid_until)}</Td>
          <Td>{r.venues.map((v) => `${v.name} (${v.courts})`).join(", ") || "—"}</Td>
          <Td>{r.owner.active === false ? <span className="text-red-400">Suspended</span> : "Active"}</Td>
          <Td><Button size="sm" variant="outline" onClick={() => setManage(r.owner.id)} data-testid={`subs-manage-${r.owner.email}`}>Manage</Button></Td>
        </tr>))} />
      <Manage ownerId={manage} onClose={() => setManage(null)} onChanged={refetch} onCreds={setCreds} />
      <Credentials creds={creds} onClose={() => setCreds(null)} />
    </div>
  );
}
