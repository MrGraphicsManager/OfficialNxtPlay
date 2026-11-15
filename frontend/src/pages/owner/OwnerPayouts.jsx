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
  { key: "legal_business_name", label: "Legal business name", placeholder: "e.g. Urban Sports Ground", minLength: 3, maxLength: 100 },
  { key: "contact_name", label: "Contact person", placeholder: "e.g. Ramesh Patel", minLength: 2, maxLength: 60 },
  { key: "email", label: "Business email", type: "email", placeholder: "e.g. contact@urbanground.com" },
  { key: "phone", label: "Mobile (10 digits)", placeholder: "e.g. 9876543210", maxLength: 10, hint: "10-digit Indian mobile" },
  { key: "street1", label: "Address line 1", placeholder: "e.g. 12, Station Road", minLength: 3, maxLength: 100 },
  { key: "street2", label: "Address line 2", placeholder: "e.g. Near City Center", optional: true, maxLength: 100 },
  { key: "city", label: "City", placeholder: "e.g. Navsari", minLength: 2, maxLength: 50 },
  { key: "state", label: "State", placeholder: "e.g. Gujarat", minLength: 2, maxLength: 50 },
  { key: "postal_code", label: "PIN code", placeholder: "e.g. 396424", maxLength: 6, hint: "6-digit PIN code" },
  { key: "business_pan", label: "Business PAN (optional)", placeholder: "e.g. ABCDE1234F", optional: true, uppercase: true, maxLength: 10, hint: "Optional: 10 chars" },
  { key: "gst", label: "GSTIN (optional)", placeholder: "e.g. 24AAAAA0000A1Z5", optional: true, uppercase: true, maxLength: 15, hint: "Optional: 15 chars" },
  { key: "stakeholder_name", label: "Owner name (as on PAN)", placeholder: "e.g. Ramesh Patel", minLength: 2, maxLength: 100 },
  { key: "stakeholder_pan", label: "Owner PAN", placeholder: "e.g. ABCDE1234F", uppercase: true, maxLength: 10, hint: "10 chars (e.g. ABCDE1234F)" },
  { key: "account_number", label: "Bank account number", placeholder: "e.g. 1234567890123", minLength: 9, maxLength: 18, hint: "9 to 18 digits" },
  { key: "ifsc_code", label: "IFSC code", placeholder: "e.g. HDFC0001234", uppercase: true, maxLength: 11, hint: "11 chars (e.g. HDFC0001234)" },
  { key: "beneficiary_name", label: "Account holder name", placeholder: "e.g. Ramesh Patel", minLength: 2, maxLength: 120 },
  { key: "category", label: "Razorpay business category", placeholder: "others", hint: "e.g. sports_and_fitness or others" },
  { key: "subcategory", label: "Razorpay business subcategory", placeholder: "others", hint: "e.g. sports_complex or others" },
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

  const handleChange = (key, val, uppercase) => {
    const v = uppercase ? val.toUpperCase() : val;
    setF((prev) => ({ ...prev, [key]: v }));
  };

  const submit = async (e) => {
    e.preventDefault();

    const phoneClean = (f.phone || "").trim();
    if (!/^[6-9]\d{9}$/.test(phoneClean)) {
      toast.error("Mobile number must be a valid 10-digit Indian number (starting with 6, 7, 8, or 9)");
      return;
    }

    const pinClean = (f.postal_code || "").trim();
    if (!/^\d{6}$/.test(pinClean)) {
      toast.error("PIN code must be a 6-digit number (e.g. 396424)");
      return;
    }

    const panRegex = /^[A-Z]{5}\d{4}[A-Z]$/;
    const ownerPan = (f.stakeholder_pan || "").trim().toUpperCase();
    if (!panRegex.test(ownerPan)) {
      toast.error("Owner PAN must be exactly 10 characters (5 letters, 4 numbers, 1 letter, e.g. ABCDE1234F)");
      return;
    }

    const bizPan = (f.business_pan || "").trim().toUpperCase();
    if (bizPan && !panRegex.test(bizPan)) {
      toast.error("Business PAN must be 10 characters (e.g. ABCDE1234F)");
      return;
    }

    const gstClean = (f.gst || "").trim().toUpperCase();
    const gstRegex = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
    if (gstClean && !gstRegex.test(gstClean)) {
      toast.error("GSTIN must be 15 characters (e.g. 24AAAAA0000A1Z5)");
      return;
    }

    const accNum = (f.account_number || "").trim();
    if (!/^\d{9,18}$/.test(accNum)) {
      toast.error("Bank account number must be between 9 and 18 digits");
      return;
    }

    const ifscClean = (f.ifsc_code || "").trim().toUpperCase();
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(ifscClean)) {
      toast.error("IFSC code must be 11 characters (4 letters, 0, 6 characters, e.g. HDFC0001234)");
      return;
    }

    if (!f.tnc_accepted) {
      toast.error("Please accept Razorpay Route terms");
      return;
    }

    setBusy(true);
    const body = {
      ...f,
      phone: phoneClean,
      postal_code: pinClean,
      account_number: accNum,
      business_pan: bizPan || null,
      gst: gstClean || null,
      ifsc_code: ifscClean,
      stakeholder_pan: ownerPan,
    };
    try {
      await api.post(`/route/owner/venues/${venue.id}/kyc`, body);
      toast.success("Details sent to Razorpay for verification");
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <PageTitle title="Payouts" sub="Business KYC and bank account for receiving booking payments" />
      <Status d={data} />
      {!active && (
        <form onSubmit={submit} className="surface p-5 sm:p-6 grid sm:grid-cols-2 gap-4" data-testid="kyc-form">
          <Field label="Business type"><select className="field" value={f.business_type} onChange={(e) => setF({ ...f, business_type: e.target.value })} data-testid="kyc-business_type">{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></Field>
          {FIELDS.map(({ key: k, label, type, placeholder, optional, uppercase, maxLength, minLength, hint }) => (
            <Field key={k} label={label} hint={hint}>
              <input
                className="field"
                type={type || "text"}
                placeholder={placeholder}
                maxLength={maxLength}
                minLength={minLength}
                value={f[k]}
                onChange={(e) => handleChange(k, e.target.value, uppercase)}
                required={!optional}
                data-testid={`kyc-${k}`}
              />
            </Field>
          ))}
          <label className="sm:col-span-2 flex gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={f.tnc_accepted} onChange={(e) => setF({ ...f, tnc_accepted: e.target.checked })} data-testid="kyc-tnc" required />I confirm these details are correct and accept Razorpay's Route terms for linked accounts.</label>
          <Button className="sm:col-span-2 font-bold" disabled={busy || !data.payments_configured} data-testid="kyc-submit-btn">{busy ? "Submitting…" : data.payments_configured ? "Submit for verification" : "Razorpay not configured yet"}</Button>
        </form>
      )}
    </div>
  );
}
