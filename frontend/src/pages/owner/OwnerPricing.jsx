import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageTitle, StatusBadge, EmptyState } from "@/components/Bits";
import { useOwner } from "@/pages/owner/OwnerLayout";
import { api, errMsg } from "@/lib/api";
import { inr, fmtDate, duration } from "@/lib/format";

export default function OwnerPricing() {
  const { venue, reloadVenues } = useOwner();
  const { data = [], refetch } = useQuery({ queryKey: ["owner-prices", venue.id], queryFn: async () => (await api.get("/owner/price-requests", { params: { venue_id: venue.id } })).data });
  const decide = async (id, approve) => {
    try {
      await api.post(`/owner/price-requests/${id}/decision`, { approve });
      toast.success(approve ? "Price approved" : "Proposal rejected");
      refetch();
      reloadVenues();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div>
      <PageTitle title="Price approvals" sub="Public prices only change after you approve. Current prices stay active while pending." />
      <div className="surface p-5 mb-6">
        <h3 className="headline text-xl mb-3">Current public prices</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {venue.courts.map((c) => (
            <div key={c.id} className="rounded-lg bg-background p-3 flex justify-between" data-testid={`owner-court-price-${c.id}`}>
              <span>{c.name} <span className="text-xs text-muted-foreground">({duration(c.slot_minutes)})</span></span><b>{inr(c.current_price)}</b>
            </div>
          ))}
        </div>
      </div>
      {data.length === 0 ? <EmptyState title="No proposals" text="Price change proposals from NXTPLAY will appear here." /> : (
        <div className="space-y-3">
          {data.map((p) => (
            <div key={p.id} className="surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4" data-testid={`price-request-${p.id}`}>
              <div>
                <p className="font-display font-bold text-xl uppercase">{p.court_name}</p>
                <p className="text-sm text-muted-foreground">Effective from {fmtDate(p.effective_date)} · per {duration(p.slot_minutes)} slot</p>
                <p className="mt-2 text-lg"><span className="text-muted-foreground line-through">{inr(p.current_price)}</span> → <b className="text-secondary">{inr(p.proposed_price)}</b></p>
              </div>
              {p.status === "pending" ? (
                <div className="flex gap-2">
                  <Button onClick={() => decide(p.id, true)} data-testid={`price-approve-${p.id}`}>Approve</Button>
                  <Button variant="outline" onClick={() => decide(p.id, false)} data-testid={`price-reject-${p.id}`}>Reject</Button>
                </div>
              ) : <StatusBadge status={p.status} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
