import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, PageTitle } from "@/components/Bits";
import { api, errMsg } from "@/lib/api";
import { useOwner } from "@/pages/owner/OwnerLayout";

const TYPES = ["individual", "proprietorship", "partnership", "private_limited", "public_limited", "llp", "trust", "society", "not_yet_registered"];
const LABEL = { draft: "Not submitted", submitted: "Submitted to Razorpay", under_review: "Under review by Razorpay", needs_clarification: "Razorpay needs more information", activated: "Active", suspended: "Suspended" };
const EMPTY = { legal_business_name: "", business_type: "proprietorship", contact_name: "", email: "", phone: "", category: "others", subcategory: "others",
  street1: "", street2: "", city: "Navsari", state: "Gujarat", postal_code: "", business_pan: "", gst: "", stakeholder_name: "", stakeholder_pan: "",
  account_number: "", ifsc_code: "", beneficiary_name: "", tnc_accepted: false };
const FIELDS = [
  ["legal_business_name", "Legal business name"], ["contact_name", "Contact person"], ["email", "Business email", "email"], ["phone", "Mobile (10 digits)"],
  ["street1", "Address line 1"], ["street2", "Address line 2"], ["city", "City"], ["state", "State"], ["postal_code", "PIN code"],
  ["business_pan", "Business PAN (optional)"], ["gst", "GSTIN (optional)"], ["stakeholder_name", "Owner name (as on PAN)"], ["stakeholder_pan", "Owner PAN"],
  ["account_number", "Bank account number"], ["ifsc_code", "IFSC code"], ["beneficiary_name", "Account holder name"],
  ["category", "Razorpay business category"], ["subcategory", "Razorpay business subcategory"],
];

function Status({ d }) {
  const la = d.linked_account;
  return (
    <div className="surface p-5 sm:p-6" data-testid="payout-status-card">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">Payout account</p>
      <p className="headline text-3xl mt-1" data-testid="payout-status">{la ? LABEL[la.status] || la.status : "Not set up"}</p>
      {la?.kyc && <p className="text-sm text-muted-foreground mt-2">{la.kyc.legal_business_name} · Bank ••••{la.kyc.bank_last4} · {la.kyc.ifsc_code}</p>}
      {la?.requirements?.length > 0 && <ul className="text-sm text-amber-300 mt-3 list-disc pl-5" data-testid="payout-requirements">{la.requirements.map((r, i) => <li key={i}>{r.reason_code || r.field_reference || JSON.stringify(r)}</li>)}</ul>}
      {la?.error && <p className="text-sm text-red-400 mt-3" data-testid="payout-error">{la.error}</p>}
      <p className="text-sm text-muted-foreground mt-4">100% of every online booking payment goes to this account through Razorpay Route. NXTPLAY charges 0% booking commission.{!d.route_enabled && " Automatic routing switches on once NXTPLAY completes Razorpay Route approval."}</p>
    </div>
  );
}

export default function OwnerPayouts() {
  const { venue } = useOwner();
  const { data, refetch } = useQuery({ queryKey: ["route", venue.id], queryFn: async () => (await api.get(`/route/owner/venues/${venue.id}`)).data });
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  if (!data) return <div className="h-40 surface animate-pulse" />;
  const active = data.linked_account?.status === "activated";
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = { ...f, business_pan: f.business_pan || null, gst: f.gst || null, ifsc_code: f.ifsc_code.toUpperCase(), stakeholder_pan: f.stakeholder_pan.toUpperCase() };
    try { await api.post(`/route/owner/venues/${venue.id}/kyc`, body); toast.success("Details sent to Razorpay for verification"); refetch(); }
    catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6 max-w-3xl">
      <PageTitle title="Payouts" sub="Business KYC and bank account for receiving booking payments" />
      <Status d={data} />
      {!active && (
        <form onSubmit={submit} className="surface p-5 sm:p-6 grid sm:grid-cols-2 gap-4" data-testid="kyc-form">
          <Field label="Business type"><select className="field" value={f.business_type} onChange={(e) => setF({ ...f, business_type: e.target.value })} data-testid="kyc-business_type">{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></Field>
          {FIELDS.map(([k, label, type]) => (
            <Field key={k} label={label}><input className="field" type={type || "text"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}
              required={!["street2", "business_pan", "gst"].includes(k)} data-testid={`kyc-${k}`} /></Field>
          ))}
          <label className="sm:col-span-2 flex gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={f.tnc_accepted} onChange={(e) => setF({ ...f, tnc_accepted: e.target.checked })} data-testid="kyc-tnc" required />I confirm these details are correct and accept Razorpay's Route terms for linked accounts.</label>
          <Button className="sm:col-span-2 font-bold" disabled={busy || !data.payments_configured} data-testid="kyc-submit-btn">{busy ? "Submitting…" : data.payments_configured ? "Submit for verification" : "Razorpay not configured yet"}</Button>
        </form>
      )}
    </div>
  );
}
