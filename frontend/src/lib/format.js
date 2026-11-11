export const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export const time12 = (min) => {
  const m = min % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const suffix = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return min === 1440 ? "12:00 AM" : `${hh}:${mm} ${suffix}`;
};

export const hmTo12 = (hm) => {
  if (!hm) return "";
  const [h, m] = hm.split(":").map(Number);
  return time12(h * 60 + m);
};

export const fmtDate = (d, opts = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", opts) : "";

export const fmtDateTime = (isoStr) =>
  isoStr ? new Date(isoStr).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";

export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};

export const duration = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h} hr` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
};

export const STATUS_LABEL = {
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  pending_payment: "Awaiting payment",
  payment_failed: "Payment failed",
  expired: "Expired",
};
