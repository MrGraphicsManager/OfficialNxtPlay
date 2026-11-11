import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, MapPinned, CalendarClock, CreditCard, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PixelBadge, NativeSelect, EmptyState } from "@/components/Bits";
import VenueCard from "@/components/VenueCard";
import { api } from "@/lib/api";
import { useMeta } from "@/lib/meta";
import { todayIST } from "@/lib/format";

const SPORT_IMG = { "Box Cricket": "/img/hero.jpg", Pickleball: "/img/pickleball.jpg" };

function SearchWidget({ meta }) {
  const nav = useNavigate();
  const navsari = meta?.cities?.find((c) => c.name === "Navsari");
  const [city, setCity] = useState("");
  const [sport, setSport] = useState("");
  const [date, setDate] = useState(todayIST());
  const cityVal = city || navsari?.id || "";
  const go = () => nav(`/venues?city=${cityVal}&sport=${sport}&date=${date}`);
  return (
    <div className="surface p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 shadow-2xl" data-testid="search-widget">
      <NativeSelect testId="search-city-select" value={cityVal} onChange={setCity}
        options={(meta?.cities || []).map((c) => ({ value: c.id, label: c.name }))} />
      <NativeSelect testId="search-sport-select" value={sport} onChange={setSport} placeholder="All sports"
        options={(meta?.sports || []).map((s) => ({ value: s.id, label: s.name }))} />
      <input type="date" className="field" data-testid="search-date-input" value={date} min={todayIST()} onChange={(e) => setDate(e.target.value)} />
      <Button className="h-11 px-6 font-bold" data-testid="search-find-slots-btn" onClick={go}><Search className="w-4 h-4 mr-2" />Find Slots</Button>
    </div>
  );
}

const STEPS = [
  { icon: MapPinned, t: "Find a Venue", d: "Search by city, sport and date to see real venues near you." },
  { icon: CalendarClock, t: "Choose Your Slot", d: "Pick a court and one or more back-to-back slots. Live availability." },
  { icon: CreditCard, t: "Pay & Play", d: "Pay securely, get your booking QR and just show up to play." },
];

export default function Home() {
  const { data: meta } = useMeta();
  const { data: venues = [], isLoading } = useQuery({ queryKey: ["venues", "featured"], queryFn: async () => (await api.get("/venues")).data });
  return (
    <div>
      <section className="relative min-h-[70vh] flex items-center overflow-hidden" data-testid="hero-section">
        <img src="/img/hero.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#080808] via-[#080808]/85 to-[#080808]/40" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#080808] to-transparent" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20 w-full">
          <div className="max-w-2xl fade-up">
            <PixelBadge>Book in Navsari</PixelBadge>
            <h1 className="headline text-6xl sm:text-7xl lg:text-8xl mt-6" data-testid="hero-headline">Your game.<br /><span className="text-primary">Your slot.</span></h1>
            <p className="text-base sm:text-lg text-muted-foreground mt-6 max-w-lg">Find, book and play at the best sports venues in your city — starting with Navsari.</p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Button size="lg" asChild className="font-bold uppercase" data-testid="hero-book-btn"><Link to="/venues">Browse All Venues</Link></Button>
              <Button size="lg" variant="outline" asChild className="font-bold bg-transparent" data-testid="hero-how-btn"><a href="#how-it-works">How It Works</a></Button>
            </div>
          </div>
          <div className="mt-12 max-w-4xl fade-up" style={{ animationDelay: ".15s" }}><SearchWidget meta={meta} /></div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 mt-20" data-testid="sports-section">
        <PixelBadge>Explore sports</PixelBadge>
        <h2 className="headline text-4xl sm:text-5xl mt-4 mb-8">Pick your game</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {(meta?.sports || []).map((s) => (
            <Link key={s.id} to={`/venues?sport=${s.id}`} data-testid={`sport-card-${s.name.toLowerCase().replace(/ /g, "-")}`}
              className="relative surface overflow-hidden h-56 lift group">
              <img src={SPORT_IMG[s.name] || "/img/hero.jpg"} alt={s.name} className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#080808] to-transparent" />
              <p className="absolute bottom-5 left-5 headline text-4xl">{s.name}</p>
            </Link>
          ))}
          <div className="surface h-56 border-dashed grid place-items-center text-center p-6" data-testid="sport-coming-soon">
            <div><Plus className="w-8 h-8 mx-auto text-secondary" /><p className="headline text-3xl mt-3">More Sports Coming Soon</p></div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 mt-24" data-testid="featured-section">
        <div className="flex items-end justify-between mb-8 gap-4">
          <div><PixelBadge>Featured venues</PixelBadge><h2 className="headline text-4xl sm:text-5xl mt-4">Play near you</h2></div>
          {venues.length > 0 && <Link to="/venues" className="text-sm font-semibold text-secondary hover:underline" data-testid="featured-see-all">See all</Link>}
        </div>
        {isLoading ? <div className="h-40 surface animate-pulse" /> : venues.length === 0 ? (
          <EmptyState testId="featured-empty" title="Your next game is coming soon." text="We're onboarding the first venues in Navsari. Check back shortly." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">{venues.slice(0, 6).map((v) => <VenueCard key={v.id} v={v} />)}</div>
        )}
      </section>

      <section id="how-it-works" className="max-w-7xl mx-auto px-4 sm:px-6 mt-24 scroll-mt-24" data-testid="how-section">
        <PixelBadge>How it works</PixelBadge>
        <h2 className="headline text-4xl sm:text-5xl mt-4 mb-8">Three steps to the turf</h2>
        <div className="grid md:grid-cols-3 gap-5">
          {STEPS.map((s, i) => (
            <div key={s.t} className="surface p-7 lift">
              <div className="flex items-center justify-between"><s.icon className="w-8 h-8 text-primary" /><span className="font-pixel text-muted-foreground">0{i + 1}</span></div>
              <h3 className="headline text-3xl mt-6">{s.t}</h3>
              <p className="text-sm text-muted-foreground mt-2">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 mt-24">
        <div className="cut bg-primary text-[#080808] p-10 sm:p-16 relative overflow-hidden" data-testid="cta-section">
          <h2 className="headline text-5xl sm:text-7xl">Less scrolling.<br />More playing.</h2>
          <Button size="lg" asChild className="mt-8 bg-[#080808] text-primary hover:bg-[#B000FF] hover:text-white font-bold" data-testid="cta-book-btn"><Link to="/venues">Book Your Slot Now</Link></Button>
          <span className="absolute right-6 bottom-6 font-pixel text-black/40 text-xs hidden sm:block">NXTPLAY // NAVSARI</span>
        </div>
      </section>
    </div>
  );
}
