"use client";

import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useFamily, useSchoolYears } from "@/hooks/use-api";

const REGISTRATION_SEGMENTS = new Set(["tuition", "enrollment-signing", "registration"]);

export function GlobalHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: familyData } = useFamily();
  const { data: yearsData } = useSchoolYears();
  const familyName = familyData?.family_name ?? null;
  const isAccepted = familyData?.isAccepted === true;

  // Detect if user is on a registration page
  const yearMatch = pathname.match(/\/apply\/year\/(\d+)/);
  const yearId = yearMatch ? Number(yearMatch[1]) : null;
  const segment = yearMatch ? pathname.replace(`/apply/year/${yearMatch[1]}`, "").replace(/^\//, "").split("/")[0] : "";
  const isRegistrationFlow = isAccepted || REGISTRATION_SEGMENTS.has(segment);

  // Get school year name
  const schoolYear = yearId && yearsData
    ? (yearsData as { id: number; year_name: string }[]).find((y) => y.id === yearId)
    : null;
  const yearName = schoolYear?.year_name ?? null;

  const title = isRegistrationFlow
    ? "SailFuture Academy Student Registration"
    : "SailFuture Academy Student Application";

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
              {title}
            </span>
            {(familyName || yearName) && (
              <span className="text-xs text-muted-foreground leading-tight">
                {familyName}{familyName && yearName && <span className="mx-1.5" aria-hidden="true">&bull;</span>}{yearName}
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
