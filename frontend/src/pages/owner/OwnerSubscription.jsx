import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageTitle, StatusBadge } from "@/components/Bits";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";

export default function OwnerSubscription() {
  const { data: sub, refetch } = useQuery({ queryKey: ["owner-subscription"], queryFn: async () => (await api.get("/subscriptions/mine")).data });
  const authorize = async () => { try { await api.post("/subscriptions/authorize"); toast.success("Authorization started. Complete the secure Razorpay payment authorization."); refetch(); } catch (e) { toast.error(errMsg(e)); } };
  const expiresSoon = sub?.current_period_end && new Date(sub.current_period_end) - new Date() <= 7 * 86400000;
  return <div><PageTitle title="Subscription" sub="Your NXTPLAY venue plan and renewal status" />
    {!sub ? <div className="surface p-5">Your Super Admin will assign a subscription plan before activation.</div> : <div className="surface p-5 space-y-4">
      <div className="flex items-center justify-between"><div><p className="headline text-3xl">₹{sub.amount}/month</p><p className="text-muted-foreground capitalize">{sub.plan} · up to {sub.court_limit} courts per venue</p></div><StatusBadge status={sub.status} /></div>
      {expiresSoon && <p className="text-amber-300">Your subscription renews within 7 days. Please ensure your recurring payment authorization remains active.</p>}
      {sub.status === "past_due" && <p className="text-amber-300">Payment needs attention. Your 7-day grace period ends {new Date(sub.grace_until).toLocaleDateString()}.</p>}
      {!sub.razorpay_subscription_id && <Button onClick={authorize}>Authorize monthly renewal</Button>}
    </div>}</div>;
}
