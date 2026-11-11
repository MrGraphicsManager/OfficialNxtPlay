import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api, errMsg } from "@/lib/api";
import { payWithRazorpay } from "@/lib/razorpay";
import { inr, fmtDate, hmTo12, duration } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export default function CheckoutDialog({ open, onClose, selection, paymentsEnabled }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [quote, setQuote] = useState(null);
  const [coupon, setCoupon] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchQuote = async (code) => {
    try {
      const { data } = await api.post("/bookings/quote", { ...selection, coupon_code: code || null });
      setQuote(data);
      if (code) toast.success(`Coupon applied: ${inr(data.discount)} off`);
    } catch (e) {
      toast.error(errMsg(e));
      if (code) setCoupon("");
      if (!code) onClose();
    }
  };

  useEffect(() => {
    if (open) {
      setQuote(null);
      setCoupon("");
      setAgree(false);
      fetchQuote(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/bookings", { ...selection, coupon_code: quote?.coupon_code || null });
      const booking = await payWithRazorpay({ order: data.order, booking: data.booking, prefill: { name: user.name, email: user.email } });
      if (booking.status === "confirmed") {
        toast.success("Booking confirmed!");
        nav(`/bookings/${booking.id}`);
      } else toast.error("Payment received but the slot became unavailable. A refund has been initiated.");
    } catch (e) {
      toast.error(e.message || errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md bg-card" data-testid="checkout-dialog">
        <DialogHeader><DialogTitle className="headline text-3xl">Checkout</DialogTitle></DialogHeader>
        {!quote ? <p className="text-muted-foreground text-sm">Calculating…</p> : (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg bg-background p-4 space-y-1.5">
              <p className="font-display font-bold text-xl uppercase">{quote.venue_name}</p>
              <p className="text-muted-foreground">{quote.court_name} · {quote.sport_name}</p>
              <p>{fmtDate(quote.date)} · {hmTo12(quote.start_time)} – {hmTo12(quote.end_time)} ({duration(quote.end_min - quote.start_min)})</p>
            </div>
            <div className="flex gap-2">
              <input className="field uppercase" placeholder="Coupon code" value={coupon} data-testid="checkout-coupon-input" onChange={(e) => setCoupon(e.target.value)} />
              <Button variant="outline" data-testid="checkout-apply-coupon-btn" disabled={!coupon} onClick={() => fetchQuote(coupon.trim())}>Apply</Button>
            </div>
            <div className="space-y-1.5">
              <Row l={`Slots (${quote.slot_starts.length} × ${inr(quote.unit_price)})`} r={inr(quote.gross_amount)} />
              {quote.discount > 0 && <Row l={`Coupon ${quote.coupon_code}`} r={`− ${inr(quote.discount)}`} testId="checkout-discount" />}
              <div className="border-t border-border pt-2"><Row l={<b>Total payable</b>} r={<b className="font-display text-2xl">{inr(quote.final_amount)}</b>} testId="checkout-total" /></div>
            </div>
            <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground" data-testid="checkout-cancellation-policy">
              <b className="text-white">Cancellation policy:</b> Free cancellation up to 24 hours before start time with a full refund to your original payment method. Within 24 hours, bookings cannot be cancelled.
            </div>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <Checkbox checked={agree} onCheckedChange={(v) => setAgree(!!v)} data-testid="checkout-agree-checkbox" />
              <span>I agree to the cancellation policy and venue rules.</span>
            </label>
            {!paymentsEnabled && <p className="text-amber-300 text-xs" data-testid="checkout-payments-disabled">Online payments are being set up. Please check back soon.</p>}
            <Button className="w-full h-12 font-bold" disabled={!agree || busy || !paymentsEnabled} onClick={pay} data-testid="checkout-pay-btn">
              {busy ? "Processing…" : `Pay ${inr(quote.final_amount)}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const Row = ({ l, r, testId }) => <div className="flex justify-between gap-3" data-testid={testId}><span className="text-muted-foreground">{l}</span><span>{r}</span></div>;
