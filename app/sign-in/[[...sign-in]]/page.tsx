"use client";

import { SignIn } from "@clerk/nextjs";
import { useState, useEffect } from "react";

export default function Page() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center">
      {mounted && <SignIn />}
    </div>
  );
}
