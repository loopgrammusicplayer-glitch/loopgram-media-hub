/**
 * Safe, tiny formatter for post bodies (no HTML injection).
 * Blank line = new paragraph, "# " / "## " = headings, a line that is just an image URL = image.
 */
export function PostBody({ body }: { body: string }) {
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="mt-6 space-y-4 leading-relaxed">
      {blocks.map((b, i) => {
        if (/^https?:\/\/\S+\.(?:jpe?g|png|webp|gif)$|^https?:\/\/\S+\/images\/[\w-]+$/i.test(b))
          return <img key={i} src={b} alt="" loading="lazy" className="w-full rounded-xl" />;
        if (b.startsWith("## ")) return <h3 key={i} className="text-xl font-semibold">{b.slice(3)}</h3>;
        if (b.startsWith("# ")) return <h2 key={i} className="text-2xl font-bold">{b.slice(2)}</h2>;
        return <p key={i} className="whitespace-pre-wrap">{b}</p>;
      })}
    </div>
  );
}
