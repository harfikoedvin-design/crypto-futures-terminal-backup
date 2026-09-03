"use client";

import { FormEvent, useState } from "react";

export default function ViewerGate() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error" | "blocked">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading") return;
    setState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/viewer/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json() as { error?: string; retryAfterSeconds?: number };
      if (!response.ok) {
        setState(response.status === 429 ? "blocked" : "error");
        setMessage(response.status === 429 ? `Terlalu banyak percobaan. Coba lagi sekitar ${Math.ceil((payload.retryAfterSeconds ?? 900) / 60)} menit.` : "Kode akses tidak valid.");
        return;
      }
      window.location.reload();
    } catch {
      setState("error");
      setMessage("Terminal belum dapat memverifikasi kode. Coba kembali.");
    }
  }

  return (
    <main className="viewer-gate-shell">
      <section className="viewer-gate-card" aria-labelledby="viewer-title">
        <div className="viewer-gate-brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><p>FIKO&apos;S PRIVATE DESK</p></div>
        <div className="viewer-gate-lock" aria-hidden="true">⌁</div>
        <p className="eyebrow">AUTHORIZED VIEWER</p>
        <h1 id="viewer-title">Crypto Futures Terminal</h1>
        <p className="viewer-gate-copy">Masukkan kode yang diberikan pemilik terminal. Akses bersifat read-only dan otomatis berakhir 5 jam setelah login.</p>
        <form onSubmit={submit} className="viewer-gate-form">
          <label htmlFor="access-code">ACCESS CODE</label>
          <input id="access-code" name="access-code" type="password" autoComplete="one-time-code" inputMode="text" minLength={6} maxLength={64} value={code} onChange={(event) => setCode(event.target.value)} disabled={state === "loading" || state === "blocked"} placeholder="••••••••" required autoFocus />
          <button type="submit" disabled={code.length < 6 || state === "loading" || state === "blocked"}>{state === "loading" ? "VERIFYING…" : "OPEN TERMINAL"}</button>
        </form>
        {message && <p className={`viewer-gate-message ${state}`} role="alert">{message}</p>}
        <footer><span>READ ONLY</span><span>SESSION 5 HOURS</span><span>NO ORDER API</span></footer>
      </section>
    </main>
  );
}
