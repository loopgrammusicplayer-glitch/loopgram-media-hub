import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Logo, btnCls, inputCls } from "@/components/Header";
import { authError, loadAuth, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Loopgram Channel" },
      { name: "description", content: "Sign in to continue to Loopgram Channel." },
      { property: "og:title", content: "Sign in — Loopgram Channel" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:description", content: "Sign in to continue to Loopgram Channel." },
    ],
  }),
  component: Login,
});

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 sm:p-8">
        <Logo />
        <h1 className="mt-6 text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function Login() {
  const { user, role, loading, configError } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user && role) nav({ to: role === "owner" ? "/owner" : "/account", replace: true });
  }, [loading, user, role, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Enter a valid email address.");
    if (!pw) return setErr("Enter your password.");
    setBusy(true);
    try {
      const auth = await loadAuth();
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      await signInWithEmailAndPassword(auth, email.trim(), pw);
    } catch (e: any) {
      setErr(e?.code ? authError(e.code) : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" sub="Sign in to continue to Loopgram Channel.">
      {configError && <p className="mb-4 text-sm text-destructive">{configError}</p>}
      {user && loading && <p className="mb-4 text-sm text-muted-foreground">Checking your account…</p>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <label className="block text-sm">
          Email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1`} />
        </label>
        <label className="block text-sm">
          Password
          <div className="relative mt-1">
            <input type={show ? "text" : "password"} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className={`${inputCls} pr-10`} />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <div className="text-right text-sm"><Link to="/forgot-password" className="text-muted-foreground hover:text-foreground">Forgot password?</Link></div>
        <button disabled={busy} className={btnCls}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here? <Link to="/register" className="text-foreground underline">Create an account</Link>
      </p>
    </AuthShell>
  );
}
