import { ExternalLink } from "lucide-react";

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

export function GlobalFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white">
      <div className="mx-auto flex items-center justify-between gap-4 px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap lg:px-6">
        {/* Copyright — always visible. Address + tagline desktop only. */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">&copy; {currentYear} SailFuture Academy</span>
          <span aria-hidden="true" className="hidden sm:inline">&bull;</span>
          <span className="hidden sm:inline truncate">2154 27th Ave N, Saint Petersburg FL 33713</span>
          <span aria-hidden="true" className="hidden lg:inline">&bull;</span>
          <span className="hidden lg:inline truncate">Where the Classroom Meets the Real World.</span>
        </div>

        {/* Links + Socials — always visible */}
        <div className="flex items-center gap-4 shrink-0">
          <a
            href="https://sailfutureacademy.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            sailfutureacademy.org
            <ExternalLink className="size-3" />
          </a>
          <a
            href="https://facebook.com/sailfuture"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
            aria-label="Facebook"
          >
            <FacebookIcon className="size-4" />
          </a>
          <a
            href="https://instagram.com/sailfuture"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
            aria-label="Instagram"
          >
            <InstagramIcon className="size-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}
