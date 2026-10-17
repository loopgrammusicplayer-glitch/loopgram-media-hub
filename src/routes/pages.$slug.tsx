import { createFileRoute, notFound } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getContent } from "@/lib/api.functions";

const NAMES: Record<string, string> = { about: "About", privacy: "Privacy Policy", terms: "Terms of Use" };

export const Route = createFileRoute("/pages/$slug")({
  loader: async ({ params }) => {
    if (!NAMES[params.slug]) throw notFound();
    const c = await getContent({ data: { slug: params.slug as "about" } });
    return { slug: params.slug, title: c.title || NAMES[params.slug]!, body: c.body };
  },
  head: ({ loaderData }) => {
    const t = `${loaderData?.title ?? "Page"} — Loopgram Channel`;
    const d = loaderData?.body.slice(0, 150) || "Loopgram Channel information page.";
    return { meta: [{ title: t }, { name: "description", content: d }, { property: "og:title", content: t }, { property: "og:description", content: d }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] };
  },
  component: Page,
});

function Page() {
  const d = Route.useLoaderData();
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <div className="mt-4 whitespace-pre-wrap text-muted-foreground">{d.body || "This page hasn't been written yet."}</div>
      </main>
      <Footer />
    </div>
  );
}
