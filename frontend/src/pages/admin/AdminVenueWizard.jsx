import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageTitle, Field, NativeSelect } from "@/components/Bits";
import { useAdminList, uploadImages } from "@/pages/admin/AdminVenues";
import { api, errMsg, imgUrl } from "@/lib/api";
import { inr, hmTo12 } from "@/lib/format";

const STEPS = ["Venue name", "Owner name", "Owner mobile", "Owner login", "City & address", "Sports", "Courts per sport", "Slot durations",
  "Opening hours", "Public prices", "Images", "Review & create"];

const INIT = { name: "", owner_mode: "new", owner_id: "", owner: { name: "", mobile: "", email: "", password: "" }, city_id: "", address: "",
  sport_ids: [], counts: {}, courts: [], open_time: "06:00", close_time: "23:00", rules: "", image_ids: [] };

const buildCourts = (f, sports) => {
  const out = [];
  f.sport_ids.forEach((sid) => {
    const n = Number(f.counts[sid] || 1);
    const sname = sports.find((s) => s.id === sid)?.name || "Court";
    for (let i = 0; i < n; i++) {
      const prev = f.courts.find((c) => c.sport_id === sid && c.idx === i);
      out.push(prev || { sport_id: sid, idx: i, name: `${sname} ${i + 1}`, slot_minutes: 60, price: "" });
    }
  });
  return out;
};

export default function AdminVenueWizard() {
  const nav = useNavigate();
  const { data: cities = [] } = useAdminList("cities");
  const { data: sports = [] } = useAdminList("sports");
  const { data: owners = [] } = useAdminList("owners");
  const [step, setStep] = useState(0);
  const [f, setF] = useState(INIT);
  const [busy, setBusy] = useState(false);
  const o = f.owner;
  const setO = (k, v) => setF({ ...f, owner: { ...o, [k]: v } });
  const setCourt = (i, k, v) => setF({ ...f, courts: f.courts.map((c, j) => (j === i ? { ...c, [k]: v } : c)) });
  const existing = f.owner_mode === "existing";

  const valid = [
    f.name.trim().length >= 2,
    existing ? !!f.owner_id : o.name.trim().length >= 2,
    existing || /^[0-9+ ]{10,15}$/.test(o.mobile),
    existing || (/\S+@\S+\.\S+/.test(o.email) && o.password.length >= 8),
    !!f.city_id && f.address.trim().length >= 3,
    f.sport_ids.length > 0,
    f.sport_ids.every((s) => Number(f.counts[s] || 1) >= 1),
    true,
    !!f.open_time && !!f.close_time && (f.close_time === "00:00" || f.close_time > f.open_time),
    f.courts.every((c) => Number(c.price) > 0),
    true,
    true,
  ];
  const next = () => {
    if (step === 1 && existing) return setStep(4);
    if (step === 6) setF({ ...f, courts: buildCourts(f, sports) });
    setStep(step + 1);
  };
  const back = () => setStep(step === 4 && existing ? 1 : step - 1);

  const create = async () => {
    setBusy(true);
    try {
      const body = { name: f.name, city_id: f.city_id, address: f.address, open_time: f.open_time, close_time: f.close_time, rules: f.rules,
        image_ids: f.image_ids, courts: f.courts.map((c) => ({ sport_id: c.sport_id, name: c.name, slot_minutes: Number(c.slot_minutes), price: Number(c.price) })),
        ...(existing ? { owner_id: f.owner_id } : { owner: o }) };
      const { data } = await api.post("/admin/venues", body);
      toast.success("Venue created and owner assigned");
      nav(`/admin/venues/${data.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const body = [
    <Field label="Venue name" key="0"><input className="field" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="wiz-venue-name" /></Field>,
    <div key="1" className="space-y-4">
      <div className="flex gap-2">
        {[["new", "New owner account"], ["existing", "Existing owner"]].map(([m, l]) => (
          <button key={m} type="button" onClick={() => setF({ ...f, owner_mode: m })} data-testid={`wiz-owner-mode-${m}`}
            className={`px-4 py-2 rounded-lg border text-sm font-semibold ${f.owner_mode === m ? "bg-primary border-primary" : "border-border"}`}>{l}</button>
        ))}
      </div>
      {existing ? <NativeSelect testId="wiz-existing-owner" value={f.owner_id} onChange={(v) => setF({ ...f, owner_id: v })} placeholder="Select owner" options={owners.map((x) => ({ value: x.id, label: `${x.name} (${x.email})` }))} />
        : <Field label="Owner full name"><input className="field" value={o.name} onChange={(e) => setO("name", e.target.value)} data-testid="wiz-owner-name" /></Field>}
    </div>,
    <Field label="Owner mobile number" key="2"><input className="field" inputMode="tel" value={o.mobile} onChange={(e) => setO("mobile", e.target.value)} data-testid="wiz-owner-mobile" /></Field>,
    <div key="3" className="space-y-4">
      <Field label="Owner email (login)"><input className="field" type="email" value={o.email} onChange={(e) => setO("email", e.target.value)} data-testid="wiz-owner-email" /></Field>
      <Field label="Temporary password" hint="Min 8 characters. Share privately with the owner; they can change it after login.">
        <input className="field" type="password" value={o.password} onChange={(e) => setO("password", e.target.value)} data-testid="wiz-owner-password" />
      </Field>
    </div>,
    <div key="4" className="space-y-4">
      <Field label="City"><NativeSelect testId="wiz-city" value={f.city_id} onChange={(v) => setF({ ...f, city_id: v })} placeholder="Select city" options={cities.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} /></Field>
      <Field label="Venue address"><textarea className="field !h-24 py-2" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="wiz-address" /></Field>
    </div>,
    <div key="5" className="flex flex-wrap gap-2">
      {sports.filter((s) => s.active).map((s) => {
        const on = f.sport_ids.includes(s.id);
        return <button key={s.id} type="button" data-testid={`wiz-sport-${s.id}`} onClick={() => setF({ ...f, sport_ids: on ? f.sport_ids.filter((x) => x !== s.id) : [...f.sport_ids, s.id] })}
          className={`px-5 py-3 rounded-lg border font-semibold ${on ? "bg-primary border-primary" : "border-border"}`}>{s.name}</button>;
      })}
    </div>,
    <div key="6" className="space-y-3">
      {f.sport_ids.map((sid) => (
        <Field key={sid} label={`${sports.find((s) => s.id === sid)?.name} — number of courts`}>
          <input type="number" min={1} max={20} className="field !w-32" value={f.counts[sid] ?? 1} onChange={(e) => setF({ ...f, counts: { ...f.counts, [sid]: e.target.value } })} data-testid={`wiz-count-${sid}`} />
        </Field>
      ))}
    </div>,
    <div key="7" className="space-y-2">
      {f.courts.map((c, i) => (
        <div key={i} className="grid grid-cols-[1fr_130px] gap-2 items-center">
          <input className="field" value={c.name} onChange={(e) => setCourt(i, "name", e.target.value)} data-testid={`wiz-court-name-${i}`} />
          <NativeSelect testId={`wiz-court-duration-${i}`} value={c.slot_minutes} onChange={(v) => setCourt(i, "slot_minutes", Number(v))} options={[{ value: 30, label: "30 min" }, { value: 60, label: "60 min" }]} />
        </div>
      ))}
    </div>,
    <div key="8" className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opening time"><input type="time" className="field" value={f.open_time} onChange={(e) => setF({ ...f, open_time: e.target.value })} data-testid="wiz-open-time" /></Field>
        <Field label="Closing time" hint="Use 00:00 for midnight"><input type="time" className="field" value={f.close_time} onChange={(e) => setF({ ...f, close_time: e.target.value })} data-testid="wiz-close-time" /></Field>
      </div>
      <Field label="Booking rules (optional)"><textarea className="field !h-20 py-2" value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} data-testid="wiz-rules" /></Field>
    </div>,
    <div key="9" className="space-y-2">
      {f.courts.map((c, i) => (
        <div key={i} className="grid grid-cols-[1fr_150px] gap-2 items-center">
          <span className="text-sm">{c.name} <span className="text-muted-foreground">· per {c.slot_minutes} min slot</span></span>
          <input type="number" min={1} className="field" placeholder="₹ price" value={c.price} onChange={(e) => setCourt(i, "price", e.target.value)} data-testid={`wiz-court-price-${i}`} />
        </div>
      ))}
    </div>,
    <div key="10" className="space-y-3">
      <input type="file" multiple accept="image/jpeg,image/png,image/webp" data-testid="wiz-images" className="text-sm"
        onChange={async (e) => { const ids = await uploadImages([...e.target.files]); setF((cur) => ({ ...cur, image_ids: [...cur.image_ids, ...ids] })); }} />
      <div className="flex flex-wrap gap-2">{f.image_ids.map((i) => <img key={i} src={imgUrl(i)} alt="" className="h-20 w-28 object-cover rounded-lg" />)}</div>
      <p className="text-xs text-muted-foreground">Optional. JPG/PNG/WEBP under 3MB. First image is the cover.</p>
    </div>,
    <div key="11" className="text-sm space-y-2" data-testid="wiz-review">
      <p><b>{f.name}</b> · {cities.find((c) => c.id === f.city_id)?.name} · {f.address}</p>
      <p>Owner: {existing ? owners.find((x) => x.id === f.owner_id)?.name : `${o.name} · ${o.mobile} · ${o.email}`}</p>
      <p>Hours: {hmTo12(f.open_time)} – {hmTo12(f.close_time)}</p>
      <ul className="list-disc pl-5 text-muted-foreground">{f.courts.map((c, i) => <li key={i}>{c.name}: {c.slot_minutes} min · {inr(c.price)}/slot</li>)}</ul>
      <p className="text-muted-foreground">{f.image_ids.length} image(s)</p>
    </div>,
  ];

  return (
    <div className="max-w-2xl">
      <PageTitle title="New venue" sub={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`} />
      <Progress value={((step + 1) / STEPS.length) * 100} className="mb-6 h-1.5" />
      <div className="surface p-6 min-h-[220px]" data-testid={`wiz-step-${step + 1}`}>
        <h2 className="headline text-3xl mb-5">{STEPS[step]}</h2>
        {body[step]}
      </div>
      <div className="flex justify-between mt-5">
        <Button variant="outline" disabled={step === 0} onClick={back} data-testid="wiz-back-btn">Back</Button>
        {step < STEPS.length - 1 ? <Button onClick={next} disabled={!valid[step]} data-testid="wiz-next-btn">Next</Button>
          : <Button onClick={create} disabled={busy} data-testid="wiz-create-btn">{busy ? "Creating…" : "Create venue"}</Button>}
      </div>
    </div>
  );
}
