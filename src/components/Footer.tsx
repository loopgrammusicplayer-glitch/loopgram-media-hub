import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="border-t border-border px-4 py-6 text-sm text-muted-foreground">
      <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2">
        <Link to="/posts" className="hover:text-foreground">Posts</Link>
        <Link to="/contact" className="hover:text-foreground">Chat With Us</Link>
        <Link to="/pages/$slug" params={{ slug: "about" }} className="hover:text-foreground">About</Link>
        <Link to="/pages/$slug" params={{ slug: "privacy" }} className="hover:text-foreground">Privacy</Link>
        <Link to="/pages/$slug" params={{ slug: "terms" }} className="hover:text-foreground">Terms</Link>
      </nav>
      <p className="mt-3 text-center">© {new Date().getFullYear()} Loopgram Channel</p>
    </footer>
  );
}
