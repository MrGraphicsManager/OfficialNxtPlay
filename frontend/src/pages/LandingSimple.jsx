import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

function Reveal({ children, className = "", delay = 0 }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add("in"); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => { io.disconnect(); };
  }, []);
  return <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

const CtaPrimary = ({ testId, children = "Book your game" }) => (
  <Link to="/book" data-testid={testId} className="inline-flex items-center gap-2 rounded-full bg-primary text-[#080808] px-7 py-3 text-base font-semibold transition-transform duration-200 hover:scale-[1.03]">
    {children} <ArrowRight className="w-4 h-4" />
  </Link>
);

function Hero() {
  return (
    <section className="pt-20 sm:pt-28 text-center px-5" data-testid="landing-hero">
      <Reveal>
        <p className="text-sm sm:text-base font-semibold text-primary tracking-wide" data-testid="landing-hero-badge">The next generation of play</p>
        <h1 className="font-display font-bold uppercase tracking-tight leading-[0.9] text-6xl sm:text-8xl lg:text-[9rem] mt-4">
          The game<br /><span className="text-primary">starts here.</span>
        </h1>
        <p className="text-lg sm:text-2xl text-muted-foreground mt-6">Your city. Your sport. Your moment.</p>
        <div className="flex flex-wrap items-center justify-center gap-6 mt-10">
          <CtaPrimary testId="landing-hero-book-btn" />
          <a href="#explore" className="text-base font-semibold text-white hover:text-primary transition-colors inline-flex items-center gap-1" data-testid="landing-hero-explore-btn">
            Explore NXTPLAY <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </Reveal>
      <Reveal delay={150} className="max-w-6xl mx-auto mt-16 sm:mt-20">
        <img src="/img/hero.jpg" alt="Floodlit box cricket turf at night" className="w-full aspect-[16/9] object-cover rounded-[28px]" />
      </Reveal>
    </section>
  );
}

const STEPS = [
  ["Find.", "Every venue in your city, with live availability."],
  ["Book.", "Pick consecutive slots and pay securely in seconds."],
  ["Play.", "Show your QR at the gate. That's it."],
];

function Steps() {
  return (
    <section id="how-it-works" className="max-w-6xl mx-auto px-5 py-28 sm:py-40" data-testid="landing-how">
      <Reveal className="text-center max-w-3xl mx-auto">
        <h2 className="font-display font-bold uppercase text-5xl sm:text-7xl leading-[0.95]">Less scrolling.<br />More playing.</h2>
      </Reveal>
      <div className="grid sm:grid-cols-3 gap-12 sm:gap-8 mt-20">
        {STEPS.map(([t, d], i) => (
          <Reveal key={t} delay={i * 120} className="text-center sm:text-left">
            <p className="font-display font-bold text-5xl text-primary">{t}</p>
            <p className="text-lg text-muted-foreground mt-3 max-w-xs mx-auto sm:mx-0">{d}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function SportTile({ name, img, line, testId }) {
  return (
    <Link to={`/book`} className="group relative block overflow-hidden rounded-[28px] bg-card aspect-[4/5] sm:aspect-[4/3]" data-testid={testId}>
      <img src={img} alt={name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      <div className="absolute left-0 right-0 bottom-0 p-7 sm:p-9">
        <p className="font-display font-bold uppercase text-4xl sm:text-5xl">{name}</p>
        <p className="text-white/70 mt-1">{line}</p>
      </div>
    </Link>
  );
}

function Sports() {
  return (
    <section id="explore" className="max-w-6xl mx-auto px-5 pb-28 sm:pb-40" data-testid="landing-sports">
      <Reveal className="text-center mb-12">
        <h2 className="font-display font-bold uppercase text-5xl sm:text-7xl">Pick your sport.</h2>
        <p className="text-lg text-muted-foreground mt-3">More sports coming soon.</p>
      </Reveal>
      <div className="grid sm:grid-cols-2 gap-5">
        <Reveal><SportTile name="Box Cricket" img="/img/hero.jpg" line="Turf. Lights. Your squad." testId="landing-sport-cricket" /></Reveal>
        <Reveal delay={120}><SportTile name="Pickleball" img="/img/pickleball.jpg" line="Fast rallies, any evening." testId="landing-sport-pickleball" /></Reveal>
      </div>
    </section>
  );
}

function Owners() {
  return (
    <section className="border-t border-border" data-testid="landing-owners">
      <Reveal className="max-w-4xl mx-auto px-5 py-28 sm:py-36 text-center">
        <p className="text-sm font-semibold text-secondary tracking-wide">For venue owners</p>
        <h2 className="font-display font-bold uppercase text-5xl sm:text-7xl mt-3">Run your turf.<br />Keep every rupee.</h2>
        <p className="text-lg text-muted-foreground mt-5 max-w-xl mx-auto">Bookings, walk-ins, pricing and QR check-ins in one dashboard. 0% booking commission.</p>
        <Link to="/contact" className="inline-flex items-center gap-1 mt-8 text-base font-semibold text-primary hover:underline" data-testid="landing-owners-btn">Partner with NXTPLAY <ArrowRight className="w-4 h-4" /></Link>
      </Reveal>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-5 pb-28 sm:pb-36" data-testid="landing-final-cta">
      <Reveal className="max-w-6xl mx-auto rounded-[28px] bg-card text-center px-6 py-20 sm:py-28">
        <h2 className="font-display font-bold uppercase text-5xl sm:text-7xl">Your slot is waiting.</h2>
        <div className="mt-10"><CtaPrimary testId="landing-final-book-btn" /></div>
      </Reveal>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="overflow-hidden" data-testid="landing-page">
      <Hero />
      <Steps />
      <Sports />
      <Owners />
      <FinalCta />
    </div>
  );
}
