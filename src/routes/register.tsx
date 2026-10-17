import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { btnCls, inputCls } from "@/components/Header";
import { authError, loadAuth } from "@/lib/auth";
import { AuthShell } from "./login";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create account — Loopgram Channel" },
      { name: "description", content: "Join Loopgram Channel." },
      { property: "og:title", content: "Create account — Loopgram Channel" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:description", content: "Join Loopgram Channel." },
    ],
  }),
  component: Register,
});

function Register() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Enter a valid email address.");
    if (pw.length < 6) return setErr("Password must be at least 6 characters.");
    setBusy(true);
    try {
      const auth = await loadAuth();
      const { createUserWithEmailAndPassword } = await import("firebase/auth");
      await createUserWithEmailAndPassword(auth, email.trim(), pw);
      nav({ to: "/account" });
    } catch (e: any) {
      setErr(e?.code ? authError(e.code) : e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Create account" sub="Join Loopgram Channel.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <label className="block text-sm">Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1`} /></label>
        <label className="block text-sm">Password<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={`${inputCls} mt-1`} /></label>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <button disabled={busy} className={btnCls}>{busy ? "Creating…" : "Create account"}</button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">Have an account? <Link to="/login" className="text-foreground underline">Sign in</Link></p>
    </AuthShell>
  );
}
