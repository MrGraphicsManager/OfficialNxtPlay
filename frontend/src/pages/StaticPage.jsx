import { useLocation } from "react-router-dom";
import { PixelBadge } from "@/components/Bits";

const PAGES = {
  "/about": {
    title: "About NXTPLAY",
    body: [
      "NXTPLAY is a sports venue booking platform launching in Navsari, Gujarat. We help players find venues, see live slot availability and book instantly.",
      "We start with Box Cricket and Pickleball, with more sports and cities coming soon.",
    ],
  },
  "/contact": {
    title: "Contact",
    body: [
      "For booking support, venue partnerships or general questions, write to us at nxtplayindia@gmail.com.",
      "Venue owners: NXTPLAY onboards venues directly. Email us your venue name, address, sports and number of courts, and our team will set up your owner account.",
    ],
  },
  "/terms": {
    title: "Terms of Use",
    body: [
      "[Placeholder — replace with your reviewed legal terms.] By booking on NXTPLAY you agree to follow venue rules and arrive on time for your slot.",
      "Bookings are confirmed only after successful payment verification. Each booking has a single-use QR code for entry.",
    ],
  },
  "/privacy": {
    title: "Privacy Policy",
    body: [
      "[Placeholder — replace with your reviewed privacy policy.] We collect your name, email and age to manage your account and bookings.",
      "Card details are handled by Razorpay and never stored by NXTPLAY. Your contact details are never shown publicly.",
    ],
  },
  "/cancellation-policy": {
    title: "Cancellation Policy",
    body: [
      "You can cancel a booking from your dashboard up to 24 hours before the scheduled start time.",
      "Within 24 hours of the start time, self-service cancellation is disabled.",
      "For eligible online payments, a full refund is initiated to your original payment method through Razorpay. Refunds usually reflect within 5–7 working days, depending on your bank.",
      "Walk-in cash bookings are handled directly by the venue.",
    ],
  },
};

export default function StaticPage() {
  const { pathname } = useLocation();
  const p = PAGES[pathname] || PAGES["/about"];
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16" data-testid="static-page">
      <PixelBadge>NXTPLAY</PixelBadge>
      <h1 className="headline text-5xl sm:text-6xl mt-4 mb-8">{p.title}</h1>
      <div className="space-y-4 text-muted-foreground leading-relaxed">{p.body.map((t) => <p key={t}>{t}</p>)}</div>
    </div>
  );
}
