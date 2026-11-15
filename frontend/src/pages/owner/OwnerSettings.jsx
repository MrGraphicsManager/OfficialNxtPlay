import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, NativeSelect, PageTitle } from "@/components/Bits";
import { api, errMsg } from "@/lib/api";
import { useMeta } from "@/lib/meta";
import { fmtDate } from "@/lib/format";
import { useOwner } from "@/pages/owner/OwnerLayout";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DURATIONS = [{ value: "30", label: "30 min" }, { value: "60", label: "60 min" }];
const Section = ({ title, children, testId }) => <section className="surface p-5 sm:p-6" data-testid={testId}><h3 className="headline text-2xl mb-4">{title}</h3>{children}</section>;
const save = async (fn, ok) => { try { await fn(); toast.success(ok); return true; } catch (e) { toast.error(errMsg(e)); return false; } };

function Profile() {
  const { data } = useQuery({ queryKey: ["owner-profile"], queryFn: async () => (await api.get("/owner/profile")).data });
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ name: data.name || "", business_name: data.business_name || "", mobile: data.mobile || "" }); }, [data]);
  if (!f) return null;
  const b = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Section title="Business profile" testId="settings-profile">
      <form className="grid sm:grid-cols-3 gap-4" onSubmit={(e) => { e.preventDefault(); save(() => api.patch("/owner/profile", { ...f, mobile: f.mobile || null }), "Profile saved"); }}>
        <Field label="Owner name"><input className="field" required minLength={2} {...b("name")} data-testid="profile-name-input" /></Field>
        <Field label="Business name"><input className="field" {...b("business_name")} data-testid="profile-business-input" /></Field>
        <Field label="Mobile"><input className="field" {...b("mobile")} data-testid="profile-mobile-input" /></Field>
        <div className="sm:col-span-3"><Button data-testid="profile-save-btn">Save profile</Button></div>
      </form>
    </Section>
  );
}

function VenueConfig({ venue, reload }) {
  const [f, setF] = useState(null);
  useEffect(() => {
    setF({ name: venue.name, address: venue.address || "", description: venue.description || "", contact_phone: venue.contact_phone || "",
      contact_email: venue.contact_email || "", open_time: venue.open_time, close_time: venue.close_time, rules: venue.rules || "",
      operating_days: venue.operating_days || [0, 1, 2, 3, 4, 5, 6] });
  }, [venue]);
  if (!f) return null;
  const b = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  const toggleDay = (d) => setF({ ...f, operating_days: f.operating_days.includes(d) ? f.operating_days.filter((x) => x !== d) : [...f.operating_days, d] });
  const submit = (e) => { e.preventDefault(); save(() => api.patch(`/owner/venues/${venue.id}/operations`, { ...f, contact_email: f.contact_email || null }), "Venue updated").then((ok) => ok && reload()); };
  return (
    <Section title="Venue configuration" testId="settings-venue">
      <form className="grid sm:grid-cols-2 gap-4" onSubmit={submit}>
        <Field label="Turf name"><input className="field" required {...b("name")} data-testid="venue-name-input" /></Field>
        <Field label="Address & location"><input className="field" required {...b("address")} data-testid="venue-address-input" /></Field>
        <Field label="Contact phone"><input className="field" {...b("contact_phone")} data-testid="venue-phone-input" /></Field>
        <Field label="Contact email"><input className="field" type="email" {...b("contact_email")} data-testid="venue-email-input" /></Field>
        <Field label="Opening time"><input className="field" type="time" required {...b("open_time")} data-testid="venue-open-input" /></Field>
        <Field label="Closing time" hint="00:00 means midnight"><input className="field" type="time" required {...b("close_time")} data-testid="venue-close-input" /></Field>
        <div className="sm:col-span-2"><Field label="Operating days">
          <div className="flex flex-wrap gap-2">{DAYS.map((d, i) => (
            <button type="button" key={d} onClick={() => toggleDay(i)} data-testid={`venue-day-${d.toLowerCase()}`}
              className={`px-3 py-2 text-sm border rounded-md transition-colors ${f.operating_days.includes(i) ? "bg-primary border-primary font-bold" : "border-border text-muted-foreground"}`}>{d}</button>
          ))}</div>
        </Field></div>
        <div className="sm:col-span-2"><Field label="Business description"><textarea className="field h-24 py-2" maxLength={1000} {...b("description")} data-testid="venue-description-input" /></Field></div>
        <div className="sm:col-span-2"><Field label="Booking rules"><textarea className="field h-20 py-2" maxLength={1000} {...b("rules")} data-testid="venue-rules-input" /></Field></div>
        <div className="sm:col-span-2"><Button data-testid="venue-save-btn">Save venue</Button></div>
      </form>
    </Section>
  );
}

function CourtRow({ c, reload }) {
  const [f, setF] = useState({ name: c.name, slot_minutes: String(c.slot_minutes), price: c.current_price, active: c.active !== false });
  const submit = () => save(() => api.patch(`/owner/courts/${c.id}`, { ...f, slot_minutes: Number(f.slot_minutes), price: Number(f.price) }), "Court saved").then((ok) => ok && reload());
  return (
    <div className="grid grid-cols-2 sm:grid-cols-[1fr_120px_110px_80px_auto] gap-3 items-end border-t border-border pt-4" data-testid={`court-row-${c.id}`}>
      <Field label={`Court · ${c.sport_name}`}><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="court-name-input" /></Field>
      <Field label="Slot"><NativeSelect value={f.slot_minutes} onChange={(v) => setF({ ...f, slot_minutes: v })} options={DURATIONS} testId="court-duration-select" /></Field>
      <Field label="Price/slot ₹"><input className="field" type="number" min={1} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} data-testid="court-price-input" /></Field>
      <Field label="Open"><div className="h-11 flex items-center"><Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} data-testid="court-active-switch" /></div></Field>
      <Button variant="outline" onClick={submit} data-testid="court-save-btn">Save</Button>
    </div>
  );
}

function Courts({ venue, reload, limit }) {
  const { data: meta } = useMeta();
  const [f, setF] = useState({ sport_id: "", name: "", slot_minutes: "60", price: "" });
  const atLimit = limit != null && venue.courts.length >= limit;
  const add = (e) => {
    e.preventDefault();
    save(() => api.post(`/owner/venues/${venue.id}/courts`, { ...f, slot_minutes: Number(f.slot_minutes), price: Number(f.price) }), "Court added")
      .then((ok) => { if (ok) { setF({ ...f, name: "", price: "" }); reload(); } });
  };
  return (
    <Section title="Courts & pricing" testId="settings-courts">
      <p className="text-sm text-muted-foreground -mt-2 mb-2" data-testid="court-limit-text">{venue.courts.length} court{venue.courts.length === 1 ? "" : "s"}{limit != null ? ` of ${limit} allowed on your plan` : ""}. Price changes apply to new bookings; confirmed bookings keep their price.</p>
      {venue.courts.map((c) => <CourtRow key={c.id} c={c} reload={reload} />)}
      {atLimit ? (
        <p className="mt-5 p-4 border border-secondary/50 bg-secondary/10 rounded-md text-sm" data-testid="court-limit-message">You've reached your plan's limit of {limit} courts per venue. Contact NXTPLAY Super Admin to upgrade to a bigger plan.</p>
      ) : (
        <form onSubmit={add} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_120px_110px_auto] gap-3 items-end border-t border-border pt-4 mt-4" data-testid="add-court-form">
          <Field label="Sport"><NativeSelect value={f.sport_id} onChange={(v) => setF({ ...f, sport_id: v })} placeholder="Select" options={(meta?.sports || []).map((s) => ({ value: s.id, label: s.name }))} testId="add-court-sport-select" /></Field>
          <Field label="New court name"><input className="field" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="add-court-name-input" /></Field>
          <Field label="Slot"><NativeSelect value={f.slot_minutes} onChange={(v) => setF({ ...f, slot_minutes: v })} options={DURATIONS} testId="add-court-duration-select" /></Field>
          <Field label="Price ₹"><input className="field" type="number" min={1} required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} data-testid="add-court-price-input" /></Field>
          <Button disabled={!f.sport_id} data-testid="add-court-btn">Add court</Button>
        </form>
      )}
    </Section>
  );
}

function Holidays({ venue }) {
  const { data = [], refetch } = useQuery({ queryKey: ["closures", venue.id], queryFn: async () => (await api.get(`/owner/venues/${venue.id}/closures`)).data });
  const [f, setF] = useState({ date: "", court_id: "", reason: "" });
  const add = (e) => { e.preventDefault(); save(() => api.post(`/owner/venues/${venue.id}/closures`, { date: f.date, court_id: f.court_id || null, reason: f.reason || "Holiday" }), "Holiday added").then((ok) => ok && refetch()); };
  const del = (id) => save(() => api.delete(`/owner/venues/${venue.id}/closures/${id}`), "Holiday removed").then(() => refetch());
  return (
    <Section title="Holidays & closures" testId="settings-holidays">
      <form onSubmit={add} className="grid grid-cols-2 sm:grid-cols-[160px_1fr_1fr_auto] gap-3 items-end">
        <Field label="Date"><input className="field" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="holiday-date-input" /></Field>
        <Field label="Court"><NativeSelect value={f.court_id} onChange={(v) => setF({ ...f, court_id: v })} placeholder="Whole venue" options={venue.courts.map((c) => ({ value: c.id, label: c.name }))} testId="holiday-court-select" /></Field>
        <Field label="Reason"><input className="field" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Holiday" data-testid="holiday-reason-input" /></Field>
        <Button data-testid="holiday-add-btn">Add</Button>
      </form>
      <div className="mt-4 divide-y divide-border">
        {data.length === 0 && <p className="text-sm text-muted-foreground">No holidays set.</p>}
        {data.map((h) => (
          <div key={h.id} className="flex items-center justify-between py-3 text-sm" data-testid={`holiday-${h.id}`}>
            <span>{fmtDate(h.date)} · {h.court_id ? venue.courts.find((c) => c.id === h.court_id)?.name || "Court" : "Whole venue"} · <span className="text-muted-foreground">{h.reason}</span></span>
            <button onClick={() => del(h.id)} className="p-2 text-muted-foreground hover:text-red-400" aria-label="Remove holiday" data-testid="holiday-delete-btn"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function OwnerSettings() {
  const { venue, reloadVenues, subInfo } = useOwner();
  return (
    <div className="space-y-6">
      <PageTitle title="Venue settings" sub="Manage your business, timings, courts, prices and holidays" />
      <Profile />
      <VenueConfig venue={venue} reload={reloadVenues} />
      <Courts venue={venue} reload={reloadVenues} limit={subInfo?.subscription?.court_limit ?? null} />
      <Holidays venue={venue} />
    </div>
  );
}
