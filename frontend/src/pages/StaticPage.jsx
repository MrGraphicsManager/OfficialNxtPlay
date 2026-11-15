import { useLocation } from "react-router-dom";
import { PixelBadge } from "@/components/Bits";

const PAGES = {
  "/about": {
    title: "About NXTPLAY",
    body: [
      "NXTPLAY is a sports venue booking platform launching in Navsari, Gujarat. Players find venues, see live slot availability and book instantly.",
      "Venue owners run their own venue on NXTPLAY — timings, courts, prices, walk-ins and QR check-ins — through a monthly subscription. NXTPLAY charges 0% commission on bookings.",
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
      "[Placeholder — have these terms reviewed by your legal advisor before launch.]",
      "Bookings: a booking is confirmed only after Razorpay confirms the payment. Each confirmed booking has a single-use QR code for entry. Players must follow venue rules and arrive on time.",
      "Payments: booking payments are processed by Razorpay. Where the venue's Razorpay Route payout account is active, 100% of the booking amount is transferred to the venue. NXTPLAY charges 0% booking commission.",
      "Venue owners: owner accounts are created by NXTPLAY only. Owners pay a monthly subscription to NXTPLAY through Razorpay automatic payments — Starter (up to 5 courts per venue) or Growth (up to 10 courts per venue). If a subscription expires, owner tools pause until renewal; venue data and booking history are kept.",
      "Owners are responsible for the accuracy of their venue details, timings, prices and payout (KYC and bank) details.",
    ],
  },
  "/privacy": {
    title: "Privacy Policy",
    body: [
      "[Placeholder — have this policy reviewed by your legal advisor before launch.]",
      "Players: we collect your name, email and age to create your account and manage bookings. Your email is verified with a one-time code. Your contact details are never shown publicly.",
      "Venue owners: business and bank (KYC) details entered for payouts are sent to Razorpay to create and verify the venue's linked account. NXTPLAY keeps only masked details (for example the last 4 digits of the bank account). Payment and subscription references are stored encrypted.",
      "Card, UPI and bank credentials are handled by Razorpay and never stored by NXTPLAY. NXTPLAY administrators can access venue and booking information to operate the platform; data is protected with HTTPS and role-based access, and sensitive admin actions are logged.",
    ],
  },
  "/cancellation-policy": {
    title: "Cancellation & Refund Policy",
    body: [
      "You can cancel a booking from your dashboard up to 24 hours before the scheduled start time. Within 24 hours of the start time, self-service cancellation is disabled.",
      "For eligible online payments, a full refund is initiated to your original payment method through Razorpay. Where the payment was transferred to the venue, the transfer is reversed from the venue's account as part of the refund.",
      "Refund status is shown in your booking. Refunds usually reflect within 5–7 working days, depending on your bank. A refund is marked complete only after Razorpay confirms it.",
      "Walk-in cash bookings are handled directly by the venue. Venue owner subscription payments are not refundable through this policy; contact nxtplayindia@gmail.com for subscription questions.",
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
