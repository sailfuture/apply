"use client";

import { SignUp } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect } from "react";

function SignUpForm() {
  const params = useSearchParams();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    <div className="flex min-h-screen items-center justify-center">
      <Suspense>
        <SignUpForm />
      </Suspense>
    </div>
  );
}
