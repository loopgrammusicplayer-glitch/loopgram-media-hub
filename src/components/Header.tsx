import { Link, useRouterState } from "@tanstack/react-router";
import logoSrc from "@/assets/logo.png";
const logo = { url: logoSrc };
import { useAuth } from "@/lib/auth";
import { SearchBar } from "@/components/SearchBar";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="Loopgram Channel home">
      <img src={logo.url} alt="" width={32} height={32} className="h-8 w-auto rounded-md object-contain" />
      <span className="whitespace-nowrap text-base font-bold tracking-tight sm:text-lg">Loopgram Channel</span>
    </Link>
  );
}

function NavTabs({ className = "" }: { className?: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const onPosts = path.startsWith("/posts");
  const onVideos = path === "/" || path.startsWith("/watch");
  const cls = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`;
  return (
    <nav aria-label="Main" className={`flex items-center gap-1 ${className}`}>
      <Link to="/" className={cls(onVideos)} aria-current={onVideos ? "page" : undefined}>Videos</Link>
      <Link to="/posts" className={cls(onPosts)} aria-current={onPosts ? "page" : undefined}>Posts</Link>
    </nav>
  );
}

export function Header() {
  const { user, role } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
      <div className="relative flex h-14 items-center justify-between gap-3 px-4">
        <Logo />
        <NavTabs className="hidden sm:flex" />
        <SearchBar />
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link to="/contact" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">Contact</Link>
          {user ? (
            <Link
              to={role === "owner" ? "/owner" : "/account"}
              className="whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-sm hover:bg-accent sm:px-4"
            >
              {role === "owner" ? "Studio" : "Account"}
            </Link>
          ) : (
            <Link to="/login" className="whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-sm hover:bg-accent sm:px-4">
              Sign in
            </Link>
          )}
        </div>
      </div>
      <NavTabs className="border-t border-border px-4 py-1.5 sm:hidden" />
    </header>
  );
}

export const inputCls =
  "w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";
export const btnCls =
  "w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50";
