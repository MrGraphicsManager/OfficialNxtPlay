import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { imgUrl } from "@/lib/api";
import { inr, duration } from "@/lib/format";

export default function VenueCard({ v, query = "" }) {
  const cover = v.image_ids?.[0] ? imgUrl(v.image_ids[0]) : "/img/hero.jpg";
  return (
    <div className="surface overflow-hidden lift flex flex-col" data-testid={`venue-card-${v.id}`}>
      <div className="relative aspect-[16/10] bg-muted">
        <img src={cover} alt={v.name} className="w-full h-full object-cover" loading="lazy" />
        {v.is_demo && <span className="absolute top-3 left-3 pixel-badge !bg-amber-500 !text-black">Demo</span>}
      </div>
      <div className="p-5 flex flex-col flex-1">
        <h3 className="font-display font-bold text-2xl uppercase leading-tight">{v.name}</h3>
        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1"><MapPin className="w-3.5 h-3.5" /> {v.city}</p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {v.sports.map((s) => <span key={s} className="text-xs px-2 py-0.5 rounded-md bg-accent text-white/90">{s}</span>)}
        </div>
        <div className="flex items-end justify-between mt-auto pt-5">
          <div>
            <p className="text-xs text-muted-foreground">Starting from</p>
            <p className="font-display font-bold text-2xl" data-testid="venue-card-price">
              {v.starting_price != null ? inr(v.starting_price) : "—"}
              {v.starting_slot_minutes && <span className="text-sm text-muted-foreground font-body font-medium"> / {duration(v.starting_slot_minutes)}</span>}
            </p>
          </div>
          <Button asChild data-testid={`venue-card-view-slots-${v.id}`}><Link to={`/venues/${v.id}${query}`}>View Slots</Link></Button>
        </div>
      </div>
    </div>
  );
}
