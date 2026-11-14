import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { CheckCircle2, XCircle, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/Bits";
import { api, errMsg } from "@/lib/api";
import { fmtDate, hmTo12, inr } from "@/lib/format";

function Result({ r }) {
  if (!r) return null;
  const b = r.booking;
  return (
    <div className={`surface p-6 border-2 ${r.valid ? "border-emerald-500" : "border-red-500"}`} data-testid="scan-result">
      <div className="flex items-center gap-3">
        {r.valid ? <CheckCircle2 className="w-10 h-10 text-emerald-400" /> : <XCircle className="w-10 h-10 text-red-400" />}
        <div>
          <p className="headline text-3xl" data-testid="scan-result-title">{r.valid ? "Valid — checked in" : "Invalid"}</p>
          <p className="text-sm text-muted-foreground" data-testid="scan-result-reason">{r.reason}</p>
        </div>
      </div>
      {b && (
        <div className="grid grid-cols-2 gap-2 mt-5 text-sm">
          <span className="text-muted-foreground">Booking</span><b className="font-pixel text-xs text-secondary">{b.code}</b>
          <span className="text-muted-foreground">Customer</span><b>{b.customer_name}</b>
          <span className="text-muted-foreground">Court</span><b>{b.court_name} · {b.sport_name}</b>
          <span className="text-muted-foreground">Slot</span><b>{fmtDate(b.date)} · {hmTo12(b.start_time)}–{hmTo12(b.end_time)}</b>
          <span className="text-muted-foreground">Amount</span><b>{inr(b.final_amount)}</b>
        </div>
      )}
    </div>
  );
}

export default function OwnerScan() {
  const scanner = useRef(null);
  const busy = useRef(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [code, setCode] = useState("");
  const [camErr, setCamErr] = useState("");

  const verify = async (payload) => {
    try {
      const { data } = await api.post("/owner/checkin", payload);
      setResult(data);
    } catch (e) {
      setResult({ valid: false, reason: errMsg(e) });
    }
  };
  const stop = async () => {
    try {
      if (scanner.current?.isScanning) await scanner.current.stop();
    } catch {}
    setRunning(false);
  };
  const start = async () => {
    setCamErr("");
    setResult(null);
    // Reveal the reader before html5-qrcode measures its dimensions.
    setRunning(true);
    try {
      scanner.current = scanner.current || new Html5Qrcode("html5-qr-reader");
      await scanner.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240, aspectRatio: 4 / 3 },
        async (text) => {
          if (busy.current) return;
          busy.current = true;
          try {
            await stop();
            await verify({ token: text });
          } finally {
            busy.current = false;
          }
        }
      );
    } catch (e) {
      try {
        if (scanner.current?.isScanning) await scanner.current.stop();
      } catch {}
      setRunning(false);
      setCamErr("Camera could not start. Use the booking code below.");
    }
  };
  useEffect(() => () => { stop(); }, []);

  return (
    <div className="max-w-xl">
      <PageTitle title="Scan booking QR" sub="Each QR works for a single check-in." />
      <div className="surface p-4 mb-5">
        <div className="relative w-full min-h-[260px]">
          <div id="html5-qr-reader" className="w-full" data-testid="qr-reader" />
          {!running && (
            <div className="absolute inset-0 grid place-items-center bg-card text-center">
              <div>
                <Camera className="w-12 h-12 text-secondary mb-4 mx-auto" />
                <Button className="font-bold h-11" onClick={start} data-testid="scan-start-btn">Open camera scanner</Button>
                {camErr && <p className="text-amber-300 text-sm mt-3" data-testid="scan-camera-error">{camErr}</p>}
              </div>
            </div>
          )}
        </div>
        {running && <Button variant="outline" className="w-full mt-3" onClick={stop} data-testid="scan-stop-btn">Stop camera</Button>}
      </div>
      <form className="surface p-4 flex gap-2 mb-5" onSubmit={(e) => { e.preventDefault(); if (code.trim()) verify({ code: code.trim() }); }}>
        <input className="field uppercase" placeholder="Booking code e.g. NXP-AB12CD3" value={code} onChange={(e) => setCode(e.target.value)} data-testid="manual-code-input" />
        <Button data-testid="manual-verify-btn">Verify</Button>
      </form>
      <Result r={result} />
    </div>
  );
}
