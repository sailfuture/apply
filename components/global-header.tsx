"use client";

import Image from "next/image";
import Link from "next/link";

export function GlobalHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b bg-white">
      <div className="mx-auto flex h-14 items-center justify-between px-4 lg:px-6">
        {/* Left: Logo (clickable) + Title */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex size-9 items-center justify-center overflow-hidden rounded-full border-2 border-primary/20 shadow-sm transition-opacity hover:opacity-80"
          >
            <Image
              src="/logo.svg"
              alt="SailFuture Academy"
              width={36}
              height={36}
              className="size-9 object-cover"
            />
          </Link>
          <span className="text-sm font-semibold tracking-tight sm:text-base">
            SailFuture Academy Student Application
          </span>
        </div>

        {/* Right: Contact info — bold, bullet separated */}
        <div className="hidden items-center gap-1.5 text-xs text-foreground md:flex">
          <span className="font-semibold">Questions?</span>
          <span aria-hidden="true">&bull;</span>
          <a
            href="mailto:admissions@sailfuture.org"
            className="hover:text-primary transition-colors"
          >
            admissions@sailfuture.org
          </a>
          <span aria-hidden="true">&bull;</span>
          <a
            href="tel:+17279001436"
            className="hover:text-primary transition-colors"
          >
            (727) 900-1436
          </a>
        </div>
      </div>
    </header>
  );
}
