import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageTitle, Table, Td } from "@/components/Bits";
import { api, errMsg } from "@/lib/api";

function Row({ v, onDone }) {
  const [acc, setAcc] = useState("");
  const la = v.linked_account;
  const act = async (fn, msg) => { try { await fn(); toast.success(msg); onDone(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <tr className="border-t border-border" data-testid={`payout-row-${v.id}`}>
      <Td>{v.name}</Td>
      <Td><span data-testid={`payout-row-status-${v.id}`}>{la ? la.status : "not set up"}</span>{la?.error && <p className="text-xs text-red-400 max-w-xs whitespace-normal">{la.error}</p>}</Td>
      <Td>{la?.kyc ? `${la.kyc.legal_business_name} · ••••${la.kyc.bank_last4}` : "—"}</Td>
      <Td>
        <div className="flex flex-wrap gap-2">
          {la?.has_linked_account && <Button size="sm" variant="outline" onClick={() => act(() => api.post(`/route/admin/venues/${v.id}/refresh`), "Status refreshed")} data-testid={`payout-refresh-${v.id}`}>Refresh</Button>}
          <input className="field h-9 w-40" placeholder="acc_…" value={acc} onChange={(e) => setAcc(e.target.value.trim())} data-testid={`payout-link-input-${v.id}`} />
          <Button size="sm" variant="outline" disabled={!acc} onClick={() => act(() => api.post(`/route/admin/venues/${v.id}/link`, { account_id: acc }), "Linked account saved")} data-testid={`payout-link-btn-${v.id}`}>Link existing</Button>
        </div>
      </Td>
    </tr>
  );
}

export default function AdminPayouts() {
  const { data, refetch } = useQuery({ queryKey: ["admin-route"], queryFn: async () => (await api.get("/route/admin/accounts")).data });
  const reconcile = async () => {
    try { const { data: r } = await api.post("/route/admin/reconcile"); toast.success(`Reconciled ${r.checked} payments${r.errors ? `, ${r.errors} errors` : ""}`); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-6">
      <PageTitle title="Venue payouts" sub="Razorpay Route linked accounts: 100% of booking payments go to the venue, 0% commission" />
      <div className="surface p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" data-testid="route-enabled-flag">Automatic routing: <span className={data?.route_enabled ? "text-primary font-bold" : "text-amber-300 font-bold"}>{data?.route_enabled ? "ON" : "OFF (existing payment flow in use until Route is approved)"}</span></p>
        <Button variant="outline" onClick={reconcile} data-testid="route-reconcile-btn">Reconcile transfers</Button>
      </div>
      <Table testId="payouts-table" cols={["Venue", "Status", "KYC", "Actions"]} rows={(data?.venues || []).map((v) => <Row key={v.id} v={v} onDone={refetch} />)} />
    </div>
  );
}
