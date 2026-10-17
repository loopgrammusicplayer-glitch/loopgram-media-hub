<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep Firebase public web configuration in a browser-safe module with optional runtime overrides; sign-in must not depend on an unrelated Google API secret.
- Default Firebase token verification to the same public project configuration as browser sign-in; an absent optional server override must not break account verification.
- Coordinate media deletion through the tested media plan using fresh exhaustive content reads, canonical storage keys, durable record deletion, shared-file preservation and cache invalidation; Firebase remains authentication-only.
