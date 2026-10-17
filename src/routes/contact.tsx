import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { Header, btnCls, inputCls } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { submitInquiry } from "@/lib/api.functions";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Chat With Us — Loopgram Channel" },
      { name: "description", content: "Contact Loopgram Channel about content, promotions, advertising and partnerships." },
      { property: "og:title", content: "Chat With Us — Loopgram Channel" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:description", content: "Contact Loopgram Channel about content, promotions, advertising and partnerships." },
    ],
  }),
  component: Contact,
});

const WA = "https://wa.me/256758630994?text=Hello%20Loopgram%20Channel%21%20I%27d%20like%20to%20discuss%20a%20content%20submission%20or%20business%20partnership.";
const EMAIL = "loopgramchannel@gmail.com";
const MAILTO = `mailto:${EMAIL}?subject=${encodeURIComponent("Loopgram Channel - Business Inquiry")}&body=${encodeURIComponent(
  "Hello Loopgram Channel,\n\nI would like to discuss a content submission, promotion, advertising opportunity, or business partnership.\n\nPlease let me know the next steps.\n\nThank you.",
)}`;

function Contact() {
  const [f, setF] = useState({ name: "", email: "", message: "" });
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    try { await submitInquiry({ data: f }); setState("done"); setF({ name: "", email: "", message: "" }); }
    catch { setState("Please check your name, a valid email, and a message of at least 5 characters."); }
  };
  const cardCls = "flex flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/40";
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <h1 className="text-2xl font-bold">Chat With Us</h1>
        <p className="mt-2 text-muted-foreground">Have content to share, a business to promote, or an idea for collaboration? Get in touch with Loopgram Channel.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className={cardCls}>
            <a href={WA} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp"><MessageCircle size={28} /></a>
            <h2 className="mt-3 font-semibold">Chat on WhatsApp</h2>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">Contact us directly about promotions, content submissions, advertising, and partnerships.</p>
            <a href={WA} target="_blank" rel="noopener noreferrer" className={`${btnCls} mt-4 text-center`}>Start Chat</a>
          </div>
          <div className={cardCls}>
            <a href={MAILTO} aria-label="Email us"><Mail size={28} /></a>
            <h2 className="mt-3 font-semibold">Email Us</h2>
            <p className="mt-1 text-sm text-muted-foreground">Have a business proposal or content inquiry? Send us an email.</p>
            <p className="mt-2 flex-1 select-all text-sm">{EMAIL}</p>
            <a href={MAILTO} className={`${btnCls} mt-4 text-center`}>Send Email</a>
            <p className="mt-2 text-xs text-muted-foreground">If no email app opens, copy the address above.</p>
          </div>
        </div>
        <form onSubmit={send} className="mt-8 space-y-3 rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Or leave a message</h2>
          <input required maxLength={100} placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} />
          <input required type="email" maxLength={255} placeholder="Your email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={inputCls} />
          <textarea required maxLength={2000} rows={4} placeholder="Message" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} className={inputCls} />
          <button disabled={state === "busy"} className={btnCls}>{state === "busy" ? "Sending…" : "Send message"}</button>
          {state === "done" && <p className="text-sm text-muted-foreground">Thanks — your message was received.</p>}
          {state.length > 10 && <p className="text-sm text-destructive">{state}</p>}
        </form>
      </main>
      <Footer />
    </div>
  );
}
