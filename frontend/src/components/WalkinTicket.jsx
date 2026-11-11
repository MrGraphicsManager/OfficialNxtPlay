import { useQuery } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import { Download, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/Bits";
import { api } from "@/lib/api";
import { inr, fmtDate, hmTo12 } from "@/lib/format";

export default function WalkinTicket({ bookingId }) {
  const { data: b } = useQuery({ queryKey: ["booking", bookingId], queryFn: async () => (await api.get(`/bookings/${bookingId}`)).data });
  if (!b) return <div className="h-64 surface animate-pulse" />;
  const text = `NXTPLAY booking confirmed\nCode: ${b.code}\n${b.venue_name} · ${b.court_name} (${b.sport_name})\n${fmtDate(b.date)} · ${hmTo12(b.start_time)}–${hmTo12(b.end_time)}\nAmount: ${inr(b.final_amount)} (${b.payment_method === "cash" ? "Cash" : "Online"})\nShow this code or QR at entry.`;
  const mobile = (b.customer_mobile || "").replace(/\D/g, "").slice(-10);
  const download = () => {
    const a = document.createElement("a");
    a.href = document.getElementById(`qr-${b.id}`).toDataURL("image/png");
    a.download = `${b.code}.png`;
    a.click();
  };
  return (
    <div className="text-center" data-testid="walkin-ticket">
      <p className="font-pixel text-primary text-lg" data-testid="walkin-ticket-code">{b.code}</p>
      <p className="text-sm text-muted-foreground mt-1">{b.customer_name} · {b.court_name} · {fmtDate(b.date)} · {hmTo12(b.start_time)}–{hmTo12(b.end_time)}</p>
      <p className="text-sm mt-1">{inr(b.final_amount)} · {b.payment_method === "cash" ? "Cash" : "Online"} <StatusBadge status={b.checked_in_at ? "checked_in" : b.status} label={b.checked_in_at ? "Checked in" : undefined} /></p>
      {b.qr_token && b.status === "confirmed" ? (
        <>
          <div className="bg-white p-4 inline-block mt-4 rounded-md" data-testid="walkin-ticket-qr">
            <QRCodeCanvas id={`qr-${b.id}`} value={b.qr_token} size={200} />
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            <Button variant="outline" onClick={download} data-testid="walkin-ticket-download"><Download className="w-4 h-4 mr-2" />Download QR</Button>
            <Button asChild data-testid="walkin-ticket-whatsapp">
              <a href={`https://wa.me/${mobile ? `91${mobile}` : ""}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle className="w-4 h-4 mr-2" />Send on WhatsApp</a>
            </Button>
          </div>
        </>
      ) : <p className="text-sm text-muted-foreground mt-4">QR is available only for confirmed bookings.</p>}
    </div>
  );
}
