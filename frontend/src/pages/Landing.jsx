import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, MapPinned, CalendarClock, QrCode, Zap } from "lucide-react";
import { PixelBadge } from "@/components/Bits";

const useReveal = () => {
  const ref = useRef(null);
  useEffect(() => {
    const els = ref.current?.querySelectorAll(".reveal") || [];
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
};

const BookBtn = ({ id, className = "" }) => (
  <Link to="/book" data-testid={id}
    className={`cut-sm inline-flex items-center gap-3 bg-primary text-[#080808] font-display font-extrabold uppercase tracking-wide text-lg px-8 h-14 hover:bg-white transition-colors ${className}`}>
    Book your game <ArrowRight className="w-5 h-5" />
  </Link>
);

const TICKER = ["Box Cricket", "Pickleball", "Live slots", "Instant QR entry", "Navsari", "More sports soon"];
const STEPS = [
  { icon: MapPinned, t: "Find a venue", d: "Pick your city, sport and day. Only real, verified venues." },
  { icon: CalendarClock, t: "Lock your slot", d: "Grab one slot or stack back-to-back hours on the same court." },
  { icon: QrCode, t: "Pay & play", d: "Pay securely, get a one-time QR and walk straight onto the turf." },
];
const SPORTS = [["Box Cricket", "/img/hero.jpg", "01"], ["Pickleball", "/img/pickleball.jpg", "02"]];

function Hero() {
  return (
    <section className="relative min-h-[92vh] flex items-end overflow-hidden" data-testid="landing-hero">
      <img src="/img/hero.jpg" alt="Floodlit box cricket turf at night" className="absolute inset-0 w-full h-full object-cover scale-105" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/70 to-[#080808]/30" />
      <div className="absolute -right-24 top-24 w-[420px] h-[420px] border-[14px] border-[#B000FF] rotate-45 opacity-70 hidden lg:block" />
      <div className="absolute right-40 top-56 w-24 h-24 bg-primary rotate-45 hidden lg:block" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pb-20 pt-32 w-full">
        <div className="fade-up"><PixelBadge>The next generation of play</PixelBadge></div>
        <h1 className="headline text-[18vw] sm:text-8xl lg:text-[10rem] mt-6 fade-up" style={{ animationDelay: ".1s" }} data-testid="landing-headline">
          The game<br /><span className="text-primary">starts here<span className="text-[#B000FF]">.</span></span>
        </h1>
        <p className="text-lg sm:text-2xl text-white/80 mt-6 font-semibold fade-up" style={{ animationDelay: ".2s" }}>Your city. Your sport. Your moment.</p>
        <div className="flex flex-wrap gap-4 mt-10 fade-up" style={{ animationDelay: ".3s" }}>
          <BookBtn id="landing-hero-book-btn" />
          <a href="#explore" data-testid="landing-explore-btn"
            className="cut-sm inline-flex items-center border-2 border-white/80 font-display font-extrabold uppercase tracking-wide text-lg px-8 h-14 hover:border-[#B000FF] hover:text-[#B000FF] transition-colors">
            Explore NXTPLAY
          </a>
        </div>
      </div>
    </section>
  );
}

function Ticker() {
  const row = [...TICKER, ...TICKER];
  return (
    <div className="bg-primary text-[#080808] py-4 overflow-hidden -rotate-1 scale-105 border-y-4 border-[#B000FF]" data-testid="landing-ticker">
      <div className="marquee flex w-max gap-10 font-pixel text-sm uppercase">
        {[...row, ...row].map((t, i) => <span key={i} className="flex items-center gap-10">{t}<Zap className="w-4 h-4 fill-current" /></span>)}
      </div>
    </div>
  );
}

function Manifesto() {
  return (
    <section id="explore" className="max-w-7xl mx-auto px-4 sm:px-6 py-28 grid lg:grid-cols-12 gap-10 scroll-mt-16" data-testid="landing-manifesto">
      <div className="lg:col-span-7 reveal">
        <PixelBadge>Why NXTPLAY</PixelBadge>
        <h2 className="headline text-6xl sm:text-7xl lg:text-8xl mt-6">No calls.<br /><span className="text-stroke">No waiting.</span><br /><span className="text-primary">Just play.</span></h2>
      </div>
      <div className="lg:col-span-5 lg:pt-24 space-y-6 reveal">
        <p className="text-xl text-white/85 leading-relaxed">Live availability across every court. Book one hour or stack three back-to-back. Your entry pass is a QR on your phone.</p>
        <div className="grid grid-cols-2 gap-px bg-border">
          {[["24/7", "Book anytime"], ["QR", "One-scan entry"], ["24H", "Free cancellation window"], ["₹", "Secure online pay"]].map(([k, v]) => (
            <div key={v} className="bg-[#080808] p-5"><p className="font-display font-extrabold text-4xl text-primary">{k}</p><p className="text-sm text-muted-foreground mt-1">{v}</p></div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Sports() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-28" data-testid="landing-sports">
      <div className="flex items-end justify-between mb-10 reveal">
        <h2 className="headline text-5xl sm:text-7xl">Pick your<br /><span className="text-[#B000FF]">arena</span></h2>
        <span className="font-pixel text-xs text-muted-foreground hidden sm:block">More sports coming soon</span>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        {SPORTS.map(([name, img, n], i) => (
          <Link key={name} to="/book" className="cut relative h-[420px] overflow-hidden group reveal" style={{ transitionDelay: `${i * 0.12}s` }} data-testid={`landing-sport-${n}`}>
            <img src={img} alt={name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/40 to-transparent" />
            <span className="absolute top-6 left-6 font-pixel text-primary text-sm">{n}</span>
            <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
              <p className="headline text-5xl sm:text-6xl">{name}</p>
              <span className="w-12 h-12 grid place-items-center bg-primary text-[#080808] group-hover:bg-[#B000FF] group-hover:text-white transition-colors"><ArrowRight /></span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function How() {
  return (
    <section id="how-it-works" className="border-y border-border bg-[#151515] scroll-mt-16" data-testid="landing-how">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-28">
        <div className="reveal"><PixelBadge>How it works</PixelBadge><h2 className="headline text-5xl sm:text-7xl mt-6 mb-14">Three moves.<br />Game on.</h2></div>
        <div className="grid md:grid-cols-3 gap-px bg-border">
          {STEPS.map((s, i) => (
            <div key={s.t} className="bg-[#151515] p-8 reveal group" style={{ transitionDelay: `${i * 0.1}s` }}>
              <p className="font-display font-extrabold text-8xl text-transparent text-stroke group-hover:text-primary transition-colors">0{i + 1}</p>
              <s.icon className="w-8 h-8 text-[#B000FF] mt-6" />
              <h3 className="headline text-4xl mt-4">{s.t}</h3>
              <p className="text-muted-foreground mt-3">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Owners() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-28" data-testid="landing-owners">
      <div className="cut bg-[#B000FF] p-10 sm:p-16 grid lg:grid-cols-2 gap-8 items-center reveal">
        <h2 className="headline text-5xl sm:text-6xl">Own a turf?<br />Fill every slot.</h2>
        <div>
          <p className="text-white/90 text-lg">Online bookings, walk-ins, QR check-ins and payouts — one dashboard built for venue owners.</p>
          <Link to="/contact?topic=owner" data-testid="landing-owners-btn" className="cut-sm inline-flex items-center gap-2 mt-6 bg-[#080808] text-primary font-display font-extrabold uppercase px-7 h-12 hover:bg-white hover:text-[#080808] transition-colors">Partner with us <ArrowRight className="w-4 h-4" /></Link>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-10 text-center" data-testid="landing-final-cta">
      <h2 className="headline text-6xl sm:text-8xl lg:text-9xl reveal">Less scrolling.<br /><span className="text-primary">More playing.</span></h2>
      <div className="mt-10 reveal"><BookBtn id="landing-final-book-btn" /></div>
    </section>
  );
}

export default function Landing() {
  const ref = useReveal();
  return (
    <div ref={ref} className="overflow-hidden">
      <Hero />
      <Ticker />
      <Manifesto />
      <Sports />
      <How />
      <Owners />
      <FinalCta />
    </div>
  );
}
