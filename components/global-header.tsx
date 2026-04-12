"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useFamily } from "@/hooks/use-api";

export function GlobalHeader() {
  const router = useRouter();
  const { data: familyData } = useFamily();
  const familyName = familyData?.family_name ?? null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b bg-white">
      <div className="mx-auto flex h-14 items-center justify-between px-4 lg:px-6">
        {/* Left: Logo (clickable) + Title + Family name */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="flex size-9 items-center justify-center overflow-hidden rounded-full border-2 border-primary/20 shadow-sm transition-opacity hover:opacity-80"
          >
            <Image
              src="/logo.svg"
              alt="SailFuture Academy"
              width={36}
              height={36}
              className="size-9 object-cover"
            />
          </button>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight sm:text-base leading-tight">
              SailFuture Academy Student Application
            </span>
            {familyName && (
              <span className="text-xs text-muted-foreground leading-tight">
                {familyName}
              </span>
            )}
          </div>
        </div>

        {/* Right: Contact info + Clerk user button */}
        <div className="flex items-center gap-4">
          <div className="hidden flex-col items-end text-xs md:flex">
            <span className="font-semibold text-foreground">Questions?</span>
            <div className="flex items-center gap-1.5 text-muted-foreground">
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
          <UserButton
            afterSignOutUrl="/sign-in"
            appearance={{
              elements: {
                avatarBox: "size-8",
              },
            }}
          />
        </div>
      </div>
    </header>
  );
}
