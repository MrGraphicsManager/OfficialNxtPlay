import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, PageTitle, StatusBadge, Table, Td } from "@/components/Bits";
import { api, errMsg } from "@/lib/api";
import { loadScript } from "@/lib/razorpay";
import { fmtDate, fmtDateTime, inr } from "@/lib/format";
import { useOwner } from "@/pages/owner/OwnerLayout";

const STATE_LABEL = {
  legacy: "No plan assigned", awaiting_authorization: "Awaiting authorization", active: "Active",
  cancelling: "Cancelled — active until period end", grace: "Payment overdue (grace period)", expired: "Expired",
};

const day = (isoStr) => (isoStr ? fmtDate(isoStr.slice(0, 10)) : "—");

export function ForcePasswordChange({ onDone }) {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (f.next !== f.confirm) return toast.error("New passwords do not match");
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: f.current, new_password: f.next });
      toast.success("Password updated. Your temporary password no longer works.");
      onDone();
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const bind = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  return (
    <div className="max-w-md surface p-6" data-testid="force-password-change">
      <Lock className="w-6 h-6 text-primary" />
      <h2 className="headline text-3xl mt-3">Set your own password</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">Your account uses a temporary password. Replace it to continue.</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Temporary password"><input className="field" type="password" required {...bind("current")} data-testid="fpc-current-input" /></Field>
        <Field label="New password" hint="Min 8 characters"><input className="field" type="password" required minLength={8} {...bind("next")} data-testid="fpc-new-input" /></Field>
        <Field label="Confirm new password"><input className="field" type="password" required minLength={8} {...bind("confirm")} data-testid="fpc-confirm-input" /></Field>
        <Button className="w-full h-11 font-bold" disabled={busy} data-testid="fpc-submit-btn">{busy ? "Saving…" : "Save new password"}</Button>
      </form>
    </div>
  );
}

export function SubscriptionGate({ info }) {
  const expired = info.access.state === "expired";
  return (
    <div className="max-w-xl surface p-6 sm:p-8" data-testid="subscription-gate">
      <span className="pixel-badge">{expired ? "Subscription expired" : "Activation pending"}</span>
      <h2 className="headline text-4xl mt-4">{expired ? "Renew to get back in the game" : "Authorize your plan to start"}</h2>
      <p className="text-muted-foreground mt-3">
        {expired ? "Your dashboard is paused because the subscription was not renewed. Your venue, courts, prices and booking history are safe and will be restored as soon as you renew."
          : "Your account is ready. Authorize monthly auto-pay through Razorpay to activate your venue dashboard."}
      </p>
      <p className="text-sm text-muted-foreground mt-2">Existing customer bookings stay valid. You can still view bookings and scan QR codes.</p>
      <Button asChild className="mt-6 font-bold" data-testid="gate-open-subscription-btn"><Link to="/owner/subscription">{expired ? "Renew subscription" : "Authorize monthly plan"}</Link></Button>
    </div>
  );
}

export function SubscriptionBanner({ info }) {
  const a = info?.access;
  const sub = info?.subscription;
  if (!a || !sub || !(a.expiring_soon || a.payment_issue)) return null;
  const issue = a.payment_issue || a.state === "grace";
  return (
    <div className={`mb-6 p-4 border flex gap-3 items-start rounded-md ${issue ? "border-red-500/50 bg-red-500/10" : "border-primary/40 bg-primary/5"}`} data-testid="subscription-banner">
      {issue ? <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" /> : <CalendarClock className="w-5 h-5 text-primary shrink-0" />}
      <div className="text-sm">
        <p className="font-semibold">{issue ? "Subscription payment needs attention" : `Your plan renews in ${a.days_left} day${a.days_left === 1 ? "" : "s"}`}</p>
        <p className="text-muted-foreground">
          {sub.plan === "growth" ? "Growth" : "Starter"} plan · paid until {day(a.paid_until)}
          {a.grace_until && ` · access continues until ${day(a.grace_until)}`}
          {sub.last_payment_error && ` · ${sub.last_payment_error}`}
        </p>
        <Link to="/owner/subscription" className="text-primary hover:underline" data-testid="banner-subscription-link">View subscription</Link>
      </div>
    </div>
  );
}

const openCheckout = async ({ subscription_id, key_id }) => {
  if (!(await loadScript())) throw new Error("Could not load Razorpay");
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: key_id, subscription_id, name: "NXTPLAY", description: "Venue owner monthly plan", theme: { color: "#C8FF00" },
      handler: resolve, modal: { ondismiss: () => reject(new Error("Authorization was not completed")) },
    });
    rzp.on("payment.failed", (r) => reject(new Error(r?.error?.description || "Payment failed")));
    rzp.open();
  });
};

export default function OwnerPlan() {
  const { subInfo: info, reloadSub } = useOwner();
  const [busy, setBusy] = useState(false);
  if (!info) return null;
  const { subscription: sub, access: a, payments } = info;
  const authorize = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/subscriptions/authorize");
      const resp = await openCheckout(data);
      await api.post("/subscriptions/verify", resp);
      toast.success("Authorization received. Your plan activates once Razorpay confirms the payment.");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); reloadSub(); }
  };
  if (!sub) return (
    <div><PageTitle title="Subscription" sub="Your NXTPLAY venue plan" />
      <div className="surface p-5 text-muted-foreground" data-testid="sub-none">No plan has been assigned yet. Your account keeps working normally until NXTPLAY assigns one.</div></div>
  );
  const needsAction = ["awaiting_authorization", "expired", "cancelling"].includes(a.state) || (!sub.has_provider_subscription && a.state !== "legacy");
  return (
    <div className="space-y-6">
      <PageTitle title="Subscription" sub="Plan, renewal status and payment history" />
      <div className="surface p-5 sm:p-6 grid gap-6 md:grid-cols-[1fr_auto]" data-testid="sub-card">
        <div>
          <p className="font-pixel text-primary text-sm uppercase">{sub.plan} plan</p>
          <p className="headline text-5xl mt-1" data-testid="sub-amount">{inr(sub.amount)}<span className="text-lg text-muted-foreground">/month</span></p>
          <p className="text-muted-foreground mt-1">Up to {sub.court_limit} courts per venue · 0% booking commission</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 text-sm">
            <Info label="Status" value={<span data-testid="sub-state">{STATE_LABEL[a.state]}</span>} />
            <Info label="Paid until" value={day(a.paid_until)} />
            <Info label="Next billing" value={day(sub.next_billing_at)} />
            <Info label="Term" value={`${fmtDate(sub.start_date)} – ${fmtDate(sub.expiry_date)}`} />
          </div>
          {sub.last_payment_error && <p className="text-red-400 text-sm mt-4" data-testid="sub-payment-error">{sub.last_payment_error}</p>}
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          <StatusBadge status={sub.status} />
          {needsAction && (
            <Button className="font-bold" disabled={busy || !info.payments_configured} onClick={authorize} data-testid="sub-authorize-btn">
              {busy ? "Opening Razorpay…" : a.state === "expired" || a.state === "cancelling" ? "Renew subscription" : "Authorize monthly auto-pay"}
            </Button>
          )}
          {needsAction && !info.payments_configured && <p className="text-xs text-muted-foreground max-w-[220px]" data-testid="sub-not-configured">Online subscription payments are being set up. NXTPLAY will contact you.</p>}
          {sub.short_url && a.state !== "active" && <a href={sub.short_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline" data-testid="sub-short-url">Open Razorpay authorization link</a>}
        </div>
      </div>
      <div>
        <h3 className="headline text-2xl mb-3">Payment history</h3>
        <Table testId="sub-payments-table" cols={["Date", "Amount", "Status", "Period", "Note"]} empty="No subscription payments yet."
          rows={payments.map((p) => (
            <tr key={p.id} className="border-t border-border"><Td>{fmtDateTime(p.created_at)}</Td><Td>{inr(p.amount)}</Td>
              <Td><StatusBadge status={p.status} /></Td><Td>{p.period_end ? `${day(p.period_start)} – ${day(p.period_end)}` : "—"}</Td><Td className="text-muted-foreground">{p.error || ""}</Td></tr>
          ))} />
      </div>
    </div>
  );
}

const Info = ({ label, value }) => <div><p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p><p className="mt-1">{value}</p></div>;
