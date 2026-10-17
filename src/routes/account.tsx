import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Your account — Loopgram Channel" },
      { name: "description", content: "Your Loopgram Channel account." },
      { property: "og:title", content: "Your account — Loopgram Channel" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:description", content: "Your Loopgram Channel account." },
    ],
  }),
  component: Account,
});

export function useSignOut() {
  const { auth } = useAuth();
  const nav = useNavigate();
  return async () => {
    if (auth) await (await import("firebase/auth")).signOut(auth);
    nav({ to: "/login", replace: true });
  };
}

function Account() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const signOut = useSignOut();
  useEffect(() => {
    if (!loading && !user) nav({ to: "/login", replace: true });
  }, [loading, user, nav]);
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-2xl font-bold">Your account</h1>
        <p className="mt-2 text-muted-foreground">{user.email}</p>
        <button onClick={signOut} className="mt-6 rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Sign out</button>
      </main>
    </div>
  );
}
