import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/Header";
import { Comments } from "@/components/Comments";

export const Route = createFileRoute("/watch_/$id/comments")({
  head: () => ({
    meta: [
      { title: "Comments — Loopgram Channel" },
      { name: "description", content: "Read and join the conversation on this Loopgram video." },
      { property: "og:title", content: "Comments — Loopgram Channel" },
      { property: "og:description", content: "Read and join the conversation on this Loopgram video." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommentsPage,
});

function CommentsPage() {
  const { id } = Route.useParams();
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-2 pb-10">
        <Link to="/watch/$id" params={{ id }} className="flex h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} aria-hidden /> Back to video</Link>
        <Comments vid={id} />
      </main>
    </div>
  );
}
