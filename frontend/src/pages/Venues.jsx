import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { NativeSelect, EmptyState, PageTitle } from "@/components/Bits";
import VenueCard from "@/components/VenueCard";
import { api } from "@/lib/api";
import { useMeta } from "@/lib/meta";
import { todayIST } from "@/lib/format";

export default function Venues() {
  const [sp, setSp] = useSearchParams();
  const { data: meta } = useMeta();
  const city = sp.get("city") || "";
  const sport = sp.get("sport") || "";
  const date = sp.get("date") || todayIST();
  const set = (k, v) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }); };
  const { data: venues = [], isLoading } = useQuery({
    queryKey: ["venues", city, sport],
    queryFn: async () => (await api.get("/venues", { params: { city_id: city || undefined, sport_id: sport || undefined } })).data,
  });
  const q = `?date=${date}${sport ? `&sport=${sport}` : ""}`;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <PageTitle title="Explore venues" sub="Real venues, live slots. Pick a court and play." />
      <div className="surface p-3 grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8" data-testid="venues-filters">
        <NativeSelect testId="filter-city" value={city} onChange={(v) => set("city", v)} placeholder="All cities"
          options={(meta?.cities || []).map((c) => ({ value: c.id, label: c.name }))} />
        <NativeSelect testId="filter-sport" value={sport} onChange={(v) => set("sport", v)} placeholder="All sports"
          options={(meta?.sports || []).map((s) => ({ value: s.id, label: s.name }))} />
        <input type="date" className="field" data-testid="filter-date" value={date} min={todayIST()} onChange={(e) => set("date", e.target.value)} />
      </div>
      {isLoading ? <div className="h-48 surface animate-pulse" /> : venues.length === 0 ? (
        <EmptyState testId="venues-empty" title="Your next game is coming soon." text="No venues match these filters yet. Try another sport or city." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="venues-grid">
          {venues.map((v) => <VenueCard key={v.id} v={v} query={q} />)}
        </div>
      )}
    </div>
  );
}
