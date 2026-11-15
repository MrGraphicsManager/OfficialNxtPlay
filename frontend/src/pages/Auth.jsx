import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, PixelBadge } from "@/components/Bits";
import { useAuth, homeFor } from "@/lib/auth";
import { api, errMsg } from "@/lib/api";

const Shell = ({ title, children, badge }) => (
  <div className="min-h-[80vh] grid place-items-center px-4 py-12">
    <div className="w-full max-w-md surface p-6 sm:p-8 fade-up">
      {badge && <PixelBadge>{badge}</PixelBadge>}
      <h1 className="headline text-5xl mt-4 mb-6">{title}</h1>
      {children}
    </div>
  </div>
);

const useForm = (init) => {
  const [f, setF] = useState(init);
  return [f, (k) => (e) => setF({ ...f, [k]: e.target.value })];
};

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [f, bind] = useForm({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(f.email, f.password);
      const next = sp.get("next");
      nav(next && u.role === "customer" ? next : homeFor(u.role), { replace: true });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Welcome back" badge="Login">
      <form onSubmit={submit} className="space-y-4" data-testid="login-form">
        <Field label="Email"><input className="field" type="email" required value={f.email} onChange={bind("email")} data-testid="login-email-input" /></Field>
        <Field label="Password"><input className="field" type="password" required value={f.password} onChange={bind("password")} data-testid="login-password-input" /></Field>
        <Button className="w-full h-11 font-bold" disabled={busy} data-testid="login-submit-btn">{busy ? "Signing in…" : "Login"}</Button>
      </form>
      <div className="flex justify-between text-sm mt-5 text-muted-foreground">
        <Link to="/forgot-password" className="hover:text-white" data-testid="login-forgot-link">Forgot password?</Link>
        <Link to="/signup" className="text-secondary hover:underline" data-testid="login-signup-link">Create account</Link>
      </div>
      <p className="text-xs text-muted-foreground mt-6">Venue owners: use the login provided by NXTPLAY.</p>
    </Shell>
  );
}

export function Signup() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [f, bind] = useForm({ name: "", email: "", password: "", age: "", otp: "" });
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("email");
  const [token, setToken] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef(null);
  useEffect(() => () => { clearInterval(timer.current); }, []);
  const tick = () => {
    setCooldown(60);
    clearInterval(timer.current);
    timer.current = setInterval(() => setCooldown((c) => { if (c <= 1) { clearInterval(timer.current); return 0; } return c - 1; }), 1000);
  };
  const run = async (fn) => { setBusy(true); try { await fn(); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); } };
  const sendOtp = (e) => {
    e?.preventDefault();
    run(async () => {
      const { data } = await api.post("/auth/registration-otp", { email: f.email });
      setStep("otp");
      tick();
      if (data?.simulated && data?.dev_otp) {
        toast.info(`Demo Mode: Your verification code is ${data.dev_otp}`, { duration: 12000 });
        setF((prev) => ({ ...prev, otp: data.dev_otp }));
      } else {
        toast.success("Code sent to your email");
      }
    });
  };
  const verify = (e) => { e.preventDefault(); run(async () => { const { data } = await api.post("/auth/verify-registration-otp", { email: f.email, otp: f.otp }); setToken(data.registration_token); setStep("details"); toast.success("Email verified"); }); };
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await register({ name: f.name, email: f.email, password: f.password, age: Number(f.age), registration_token: token });
      toast.success("Account created. Let's play!");
      nav("/dashboard", { replace: true });
    });
  };
  return (
    <Shell title="Join NXTPLAY" badge={`Step ${{ email: 1, otp: 2, details: 3 }[step]} of 3`}>
      {step === "email" && (
        <form onSubmit={sendOtp} className="space-y-4" data-testid="signup-email-form">
          <Field label="Email" hint="We'll send a 6-digit code to verify it"><input className="field" type="email" required value={f.email} onChange={bind("email")} data-testid="signup-email-input" /></Field>
          <Button className="w-full h-11 font-bold" disabled={busy} data-testid="signup-send-otp-btn">{busy ? "Sending…" : "Send verification code"}</Button>
        </form>
      )}
      {step === "otp" && (
        <form onSubmit={verify} className="space-y-4" data-testid="signup-otp-form">
          <p className="text-sm text-muted-foreground">Code sent to <span className="text-white">{f.email}</span>. It expires in 10 minutes.</p>
          <Field label="Verification code"><input className="field tracking-[0.5em] text-center text-lg" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={f.otp} onChange={bind("otp")} data-testid="signup-otp-input" /></Field>
          <Button className="w-full h-11 font-bold" disabled={busy} data-testid="signup-verify-otp-btn">{busy ? "Verifying…" : "Verify email"}</Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-muted-foreground hover:text-white" onClick={() => setStep("email")} data-testid="signup-change-email-btn">Change email</button>
            <button type="button" className="text-primary disabled:text-muted-foreground" disabled={cooldown > 0 || busy} onClick={sendOtp} data-testid="signup-resend-otp-btn">{cooldown ? `Resend in ${cooldown}s` : "Resend code"}</button>
          </div>
        </form>
      )}
      {step === "details" && (
        <form onSubmit={submit} className="space-y-4" data-testid="signup-form">
          <p className="text-sm text-primary" data-testid="signup-verified-email">Verified: {f.email}</p>
          <Field label="Full name"><input className="field" required minLength={2} value={f.name} onChange={bind("name")} data-testid="signup-name-input" /></Field>
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <Field label="Password" hint="Min 8 characters"><input className="field" type="password" required minLength={8} value={f.password} onChange={bind("password")} data-testid="signup-password-input" /></Field>
            <Field label="Age"><input className="field" type="number" required min={5} max={100} value={f.age} onChange={bind("age")} data-testid="signup-age-input" /></Field>
          </div>
          <Button className="w-full h-11 font-bold" disabled={busy} data-testid="signup-submit-btn">{busy ? "Creating…" : "Create account"}</Button>
        </form>
      )}
      <p className="text-sm mt-5 text-muted-foreground">Already have an account? <Link to="/login" className="text-secondary hover:underline">Login</Link></p>
    </Shell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/forgot-password", { email });
      setDone(true);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <Shell title="Reset password" badge="Account">
      {done ? <p className="text-sm text-muted-foreground" data-testid="forgot-done">If this email is registered, you'll receive a reset link shortly. Need help? Contact NXTPLAY support.</p> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email"><input className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email-input" /></Field>
          <Button className="w-full h-11 font-bold" data-testid="forgot-submit-btn">Send reset link</Button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/reset-password", { token: sp.get("token") || "", new_password: pw });
      toast.success("Password updated. Please login.");
      nav("/login");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <Shell title="New password" badge="Account">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password"><input className="field" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} data-testid="reset-password-input" /></Field>
        <Button className="w-full h-11 font-bold" data-testid="reset-submit-btn">Update password</Button>
      </form>
    </Shell>
  );
}
