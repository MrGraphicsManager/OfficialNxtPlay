import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageTitle, StatusBadge, Table, Td, Field, NativeSelect } from "@/components/Bits";
import { api, errMsg, imgUrl } from "@/lib/api";
import { useMeta } from "@/lib/meta";
import { inr, hmTo12, duration } from "@/lib/format";

export const useAdminList = (path) => useQuery({ queryKey: ["admin", path], queryFn: async () => (await api.get(`/admin/${path}`)).data });

export async function uploadImages(files) {
  const ids = [];
  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      ids.push((await api.post("/admin/images", fd)).data.id);
    } catch (e) {
      toast.error(`${file.name}: ${errMsg(e)}`);
    }
  }
  return ids;
}

export function AdminVenues() {
  const { data = [], refetch } = useAdminList("venues");
  const toggle = async (v) => {
    try {
      await api.patch(`/admin/venues/${v.id}`, { status: v.status === "active" ? "inactive" : "active" });
      refetch();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div>
      <PageTitle title="Venues" right={<Button asChild data-testid="venues-new-btn"><Link to="/admin/venues/new">Create venue</Link></Button>} />
      <Table testId="admin-venues-table" cols={["Venue", "City", "Owners", "Courts", "Hours", "Active", ""]} empty="No venues yet. Create your first venue."
        rows={data.map((v) => (
          <tr key={v.id} className="border-b border-border last:border-0" data-testid={`admin-venue-row-${v.id}`}>
            <Td className="font-semibold">{v.name}{v.is_demo && <span className="ml-2 text-[10px] text-amber-300 uppercase">demo</span>}</Td>
            <Td>{v.city}</Td><Td>{v.owners.join(", ") || "—"}</Td><Td>{v.court_count}</Td>
            <Td>{hmTo12(v.open_time)} – {hmTo12(v.close_time)}</Td>
            <Td><Switch checked={v.status === "active"} onCheckedChange={() => toggle(v)} data-testid={`venue-status-switch-${v.id}`} /></Td>
            <Td><Button size="sm" variant="outline" asChild data-testid={`venue-manage-${v.id}`}><Link to={`/admin/venues/${v.id}`}>Manage</Link></Button></Td>
          </tr>
        ))} />
    </div>
  );
}

function CourtsEditor({ venue, sports, onChange }) {
  const [n, setN] = useState({ sport_id: sports[0]?.id || "", name: "", slot_minutes: 60, price: "" });
  const sname = (id) => sports.find((s) => s.id === id)?.name || "";
  const patch = async (c, body) => {
    try {
      onChange((await api.patch(`/admin/courts/${c.id}`, body)).data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const add = async () => {
    try {
      onChange((await api.post(`/admin/venues/${venue.id}/courts`, { ...n, sport_id: n.sport_id || sports[0]?.id, slot_minutes: Number(n.slot_minutes), price: Number(n.price) })).data);
      setN({ ...n, name: "", price: "" });
      toast.success("Court added");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="surface p-5">
      <h3 className="headline text-2xl mb-4">Courts</h3>
      <div className="space-y-2 mb-5">
        {venue.courts.map((c) => (
          <div key={c.id} className="grid grid-cols-2 sm:grid-cols-[1fr_120px_110px_100px_60px] gap-2 items-center bg-background rounded-lg p-3" data-testid={`admin-court-${c.id}`}>
            <div><p className="font-semibold">{c.name}</p><p className="text-xs text-muted-foreground">{sname(c.sport_id)}</p></div>
            <NativeSelect value={c.slot_minutes} onChange={(v) => patch(c, { slot_minutes: Number(v) })} options={[{ value: 30, label: "30 min" }, { value: 60, label: "60 min" }]} testId={`court-duration-${c.id}`} />
            <p className="text-sm">{inr(c.current_price)} <span className="text-muted-foreground">/slot</span></p>
            <span className="text-xs text-muted-foreground">{c.active ? "Bookable" : "Disabled"}</span>
            <Switch checked={c.active} onCheckedChange={(v) => patch(c, { active: v })} data-testid={`court-active-${c.id}`} />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mb-2">Prices change only through owner-approved proposals (Pricing).</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <NativeSelect testId="new-court-sport" value={n.sport_id} onChange={(v) => setN({ ...n, sport_id: v })} options={sports.map((s) => ({ value: s.id, label: s.name }))} />
        <input className="field" placeholder="Court name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} data-testid="new-court-name" />
        <NativeSelect testId="new-court-duration" value={n.slot_minutes} onChange={(v) => setN({ ...n, slot_minutes: v })} options={[{ value: 30, label: "30 min" }, { value: 60, label: "60 min" }]} />
        <input className="field" type="number" placeholder="Price / slot" value={n.price} onChange={(e) => setN({ ...n, price: e.target.value })} data-testid="new-court-price" />
        <Button onClick={add} disabled={!n.name || !n.price} data-testid="new-court-add-btn">Add court</Button>
      </div>
    </div>
  );
}

export function AdminVenueManage() {
  const { id } = useParams();
  const { data: meta } = useMeta();
  const { data: sports = [] } = useAdminList("sports");
  const { data: owners = [] } = useAdminList("owners");
  const [v, setV] = useState(null);
  const { data: loaded } = useQuery({ queryKey: ["admin-venue", id], staleTime: 0, queryFn: async () => (await api.get(`/admin/venues/${id}`)).data });
  useEffect(() => {
    if (loaded) setV(loaded);
  }, [loaded]);
  if (!v) return <div className="h-40 surface animate-pulse" />;
  const save = async () => {
    try {
      const body = { name: v.name, address: v.address, city_id: v.city_id, open_time: v.open_time, close_time: v.close_time, rules: v.rules,
        status: v.status, image_ids: v.image_ids, owner_ids: v.owner_ids, is_demo: v.is_demo };
      setV((await api.patch(`/admin/venues/${id}`, body)).data);
      toast.success("Venue saved");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const toggleOwner = (oid) => setV({ ...v, owner_ids: v.owner_ids.includes(oid) ? v.owner_ids.filter((x) => x !== oid) : [...v.owner_ids, oid] });
  return (
    <div className="space-y-6 max-w-5xl">
      <PageTitle title={v.name} sub="Edit venue details, owners, images and courts" right={<StatusBadge status={v.status} />} />
      <div className="surface p-5 grid sm:grid-cols-2 gap-4" data-testid="venue-edit-form">
        <Field label="Venue name"><input className="field" value={v.name} onChange={set("name")} data-testid="venue-edit-name" /></Field>
        <Field label="City"><NativeSelect value={v.city_id} onChange={(x) => setV({ ...v, city_id: x })} options={(meta?.cities || []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Address"><input className="field" value={v.address} onChange={set("address")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opens"><input type="time" className="field" value={v.open_time} onChange={set("open_time")} data-testid="venue-edit-open" /></Field>
          <Field label="Closes"><input type="time" className="field" value={v.close_time} onChange={set("close_time")} data-testid="venue-edit-close" /></Field>
        </div>
        <div className="sm:col-span-2"><Field label="Booking rules"><textarea className="field !h-24 py-2" value={v.rules} onChange={set("rules")} /></Field></div>
        <div className="sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Owners</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {owners.map((o) => (
              <button key={o.id} type="button" onClick={() => toggleOwner(o.id)} data-testid={`venue-owner-toggle-${o.id}`}
                className={`px-3 py-1.5 rounded-lg border text-sm ${v.owner_ids.includes(o.id) ? "bg-primary border-primary" : "border-border"}`}>{o.name}</button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Images</span>
          <div className="flex flex-wrap gap-2 mt-2 items-center">
            {v.image_ids.map((i) => (
              <div key={i} className="relative"><img src={imgUrl(i)} alt="" className="h-20 w-28 object-cover rounded-lg" />
                <button className="absolute -top-2 -right-2 bg-red-500 rounded-full p-0.5" onClick={() => setV({ ...v, image_ids: v.image_ids.filter((x) => x !== i) })}><X className="w-3 h-3" /></button></div>
            ))}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="text-sm" data-testid="venue-edit-images"
              onChange={async (e) => { const ids = await uploadImages([...e.target.files]); setV((cur) => ({ ...cur, image_ids: [...cur.image_ids, ...ids] })); }} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={v.is_demo} onCheckedChange={(x) => setV({ ...v, is_demo: x })} /> Demo / test venue</label>
        <div className="flex justify-end"><Button onClick={save} data-testid="venue-edit-save-btn">Save changes</Button></div>
      </div>
      <CourtsEditor venue={v} sports={sports} onChange={setV} />
      <p className="text-xs text-muted-foreground">Slot durations: {v.courts.map((c) => `${c.name} ${duration(c.slot_minutes)}`).join(" · ")}</p>
    </div>
  );
}
