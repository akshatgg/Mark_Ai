"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  /** Which workbench this render is mounted in. */
  current: "image" | "video";
}

/**
 * A route, not a state flag — see markai-creative-fit-web/CLAUDE.md and the
 * phase C/D/E plan's Task 10: a `useState` mode inside page.tsx would force
 * the tested image workbench into branches it has never had to handle. This
 * renders inside each page's own header; the app has no shared layout or
 * `PageHeader` to hang a toggle on.
 *
 * `current` is the source of truth for styling (deterministic — no flicker
 * while the router resolves). `usePathname()` is read too, purely as a
 * live cross-check so a stale `current` prop can never disagree with the
 * URL the user is actually looking at.
 */
export function FitModeToggle({ current }: Props) {
  const pathname = usePathname();
  const live = pathname?.startsWith("/video") ? "video" : "image";
  const active = live ?? current;

  return (
    <nav className="mb-4 inline-flex items-center gap-1 rounded-[8px] border border-line-strong bg-canvas-subtle p-1">
      <Link
        href="/"
        aria-current={active === "image" ? "page" : undefined}
        className={`rounded-[6px] px-3 py-1 text-[12px] transition-colors ${
          active === "image" ? "bg-panel text-fg" : "text-fg-muted hover:text-fg"
        }`}
      >
        Image
      </Link>
      <Link
        href="/video"
        aria-current={active === "video" ? "page" : undefined}
        className={`rounded-[6px] px-3 py-1 text-[12px] transition-colors ${
          active === "video" ? "bg-panel text-fg" : "text-fg-muted hover:text-fg"
        }`}
      >
        Video
      </Link>
    </nav>
  );
}
