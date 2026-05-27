"use client";

import { SignUp } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useIsClient } from "@/hooks/use-is-client";

function SignUpForm() {
  const params = useSearchParams();
  const mounted = useIsClient();

  if (!mounted) return null;

  return (
    <SignUp
      initialValues={{
        firstName: params.get("firstName") ?? undefined,
        lastName: params.get("lastName") ?? undefined,
        emailAddress: params.get("email") ?? undefined,
      }}
    />
  );
}

export default function Page() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center">
      <Suspense>
        <SignUpForm />
      </Suspense>
    </div>
  );
}
