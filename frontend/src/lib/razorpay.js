import { api, errMsg } from "@/lib/api";

const loadScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });

// Opens Razorpay checkout; resolves with the server-verified booking, rejects on failure/dismiss.
export async function payWithRazorpay({ order, booking, prefill = {}, description }) {
  const ok = await loadScript();
  if (!ok) throw new Error("Could not load Razorpay checkout. Check your connection.");
  return new Promise((resolve, reject) => {
    const abandon = async (msg) => {
      try {
        await api.post(`/payments/${booking.id}/abandon`);
      } catch {}
      reject(new Error(msg));
    };
    const rzp = new window.Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.id,
      name: "NXTPLAY",
      description: description || `${booking.venue_name} · ${booking.court_name}`,
      prefill,
      theme: { color: "#C8FF00" },
      handler: async (res) => {
        try {
          const { data } = await api.post("/payments/verify", res);
          resolve(data);
        } catch (e) {
          reject(new Error(errMsg(e)));
        }
      },
      modal: { ondismiss: () => abandon("Payment cancelled. Your slot hold was released.") },
    });
    rzp.on("payment.failed", (r) => abandon(r?.error?.description || "Payment failed"));
    rzp.open();
  });
}
