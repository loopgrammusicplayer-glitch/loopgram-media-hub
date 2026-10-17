import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { btnCls, inputCls } from "@/components/Header";
import { loadAuth } from "@/lib/auth";
import { AuthShell } from "./login";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Loopgram Channel" },
      { name: "description", content: "Reset your Loopgram Channel password." },
      { property: "og:title", content: "Reset password — Loopgram Channel" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:description", content: "Reset your Loopgram Channel password." },
    ],
  }),
  component: Forgot,
});

function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const auth = await loadAuth();
      const { sendPasswordResetEmail } = await import("firebase/auth");
      await sendPasswordResetEmail(auth, email.trim());
    } catch {
      /* never reveal whether the email exists */
    }
    setSent(true);
    setBusy(false);
  };
  return (
    <AuthShell title="Reset password" sub="We'll email you a reset link.">
      {sent ? (
        <p className="text-sm text-muted-foreground">If an account exists for that email, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1`} /></label>
          <button disabled={busy} className={btnCls}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link to="/login" className="text-muted-foreground underline">Back to sign in</Link></p>
    </AuthShell>
  );
}
