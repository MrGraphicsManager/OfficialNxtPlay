import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Share2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { StatusBadge, EmptyState } from "@/components/Bits";
import { CustomerTabs } from "@/pages/customer/MyBookings";
import { api, errMsg } from "@/lib/api";
import { inr, fmtDate, hmTo12, duration, fmtDateTime } from "@/lib/format";

const Row = ({ l, v, testId }) => (
  <div className="flex justify-between gap-4 py-2.5 border-b border-border last:border-0 text-sm">
    <span className="text-muted-foreground">{l}</span><span className="font-semibold text-right" data-testid={testId}>{v}</span>
  </div>
);

export default function BookingDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { data: b, isLoading, isError, refetch } = useQuery({ queryKey: ["booking", id], queryFn: async () => (await api.get(`/bookings/${id}`)).data });
  if (isLoading) return <div className="max-w-4xl mx-auto p-6"><div className="h-80 surface animate-pulse" /></div>;
  if (isError || !b) return <div className="max-w-3xl mx-auto p-6"><EmptyState title="Booking not found" /></div>;

  const share = async () => {
    const text = `NXTPLAY booking ${b.code}: ${b.venue_name} · ${b.court_name} · ${fmtDate(b.date)} ${hmTo12(b.start_time)}–${hmTo12(b.end_time)}`;
    try {
      if (navigator.share) await navigator.share({ title: "My NXTPLAY booking", text });
      else { await navigator.clipboard.writeText(text); toast.success("Booking details copied"); }
    } catch {}
  };
  const cancel = async () => {
    try {
      await api.post(`/bookings/${id}/cancel`);
      toast.success("Booking cancelled. Refund initiated if applicable.");
      refetch();
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const status = b.checked_in_at ? "checked_in" : b.status;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <CustomerTabs />
      <Link to="/my-bookings" className="text-sm text-muted-foreground flex items-center gap-1 mb-4 hover:text-white"><ArrowLeft className="w-4 h-4" />All bookings</Link>
      <div className="grid md:grid-cols-[1fr_300px] gap-6">
        <div className="surface p-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="font-pixel text-xs text-secondary" data-testid="booking-code">{b.code}</p>
              <h1 className="headline text-4xl mt-2">{b.venue_name}</h1>
            </div>
            <StatusBadge testId="booking-status" status={status} label={b.checked_in_at ? "Checked in" : undefined} />
          </div>
          <Row l="Court" v={b.court_name} />
          <Row l="Sport" v={b.sport_name} />
          <Row l="Date" v={fmtDate(b.date)} testId="booking-date" />
          <Row l="Start time" v={hmTo12(b.start_time)} testId="booking-start" />
          <Row l="End time" v={hmTo12(b.end_time)} testId="booking-end" />
          <Row l="Duration" v={duration(b.end_min - b.start_min)} />
          {b.discount > 0 && <Row l={`Discount (${b.coupon_code})`} v={`− ${inr(b.discount)}`} />}
          <Row l="Amount paid" v={inr(b.final_amount)} testId="booking-amount" />
          {b.paid_via && <Row l="Paid via" v={<span className="capitalize">{b.paid_via}</span>} />}
          {b.refund_status && <Row l="Refund" v={<StatusBadge testId="booking-refund-status" status={b.refund_status} />} />}
          {b.cancel_reason && <Row l="Note" v={b.cancel_reason} />}
          <div className="flex flex-wrap gap-3 mt-6">
            <Button variant="outline" onClick={share} data-testid="booking-share-btn"><Share2 className="w-4 h-4 mr-2" />Share booking</Button>
            {b.can_cancel ? (
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="destructive" data-testid="booking-cancel-btn">Cancel booking</Button></AlertDialogTrigger>
                <AlertDialogContent className="bg-card">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
                    <AlertDialogDescription>The slot will be released and a full refund of {inr(b.final_amount)} will be initiated to your original payment method.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep booking</AlertDialogCancel>
                    <AlertDialogAction onClick={cancel} data-testid="booking-cancel-confirm-btn">Yes, cancel</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : b.status === "confirmed" && !b.checked_in_at && (
              <p className="text-xs text-muted-foreground self-center" data-testid="booking-cancel-closed">Cancellation closes 24 hours before start time.</p>
            )}
          </div>
        </div>
        <div className="surface p-6 text-center h-fit">
          {b.status === "confirmed" && b.qr_token ? (
            <>
              <div className="bg-white p-4 rounded-xl inline-block" data-testid="booking-qr"><QRCodeSVG value={b.qr_token} size={200} /></div>
              <p className="text-xs text-muted-foreground mt-4">{b.checked_in_at ? `Checked in ${fmtDateTime(b.checked_in_at)}` : "Show this QR at the venue for entry. Single use only."}</p>
            </>
          ) : <p className="text-sm text-muted-foreground py-10">QR code is available only for confirmed bookings.</p>}
        </div>
      </div>
    </div>
  );
}
