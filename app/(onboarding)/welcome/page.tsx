"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Field,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { StateSelect } from "@/components/state-select";

/**
 * First-time onboarding for a new family. We capture the primary parent /
 * guardian's name + home address; the family record's `family_name` is
 * derived from the last name on submit (e.g. "Walsh Family"). The parent
 * row already exists from the Clerk webhook (`user.created` → seeds
 * first/last from Clerk), but we let the parent override those names here
 * since Clerk's first/last can be wrong if they signed up with just an
 * email — and either way this is the first time they've explicitly
 * named themselves on the application side.
 */
export default function WelcomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");

  // If a family already exists, bounce back to the home redirect (which
  // routes through admin / apply / dashboard depending on lifecycle).
  // Also pre-fill name fields from the existing parent record so the user
  // sees what we already have on file before they confirm.
  useEffect(() => {
    async function bootstrap() {
      try {
        const familyRes = await fetch("/api/families");
        if (familyRes.ok) {
          const data = await familyRes.json();
          if (data?.id) {
            router.replace("/");
            return;
          }
        }
        // Pre-fill from the parent record (created on Clerk signup via the
        // webhook). Quietly swallow errors — the form still works without it.
        try {
          const me = await fetch("/api/parents/me");
          if (me.ok) {
            const parent = await me.json();
            if (parent?.first_name) setFirstName(parent.first_name);
            if (parent?.last_name) setLastName(parent.last_name);
          }
        } catch {
          /* no-op */
        }
      } catch {
        // continue to show welcome
      }
      setLoading(false);
    }
    bootstrap();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Primary parent's name is the canonical input now. The route
          // derives `family_name` ("{lastName} Family") from these and
          // updates the parent row so the names align across surfaces.
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          address_line_1: addressLine1,
          address_line_2: addressLine2,
          city,
          state,
          zip,
        }),
      });

      if (res.ok) {
        router.replace("/");
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center">
        <Spinner className="size-8 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] flex-col items-center justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-lg space-y-8">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="relative size-16 overflow-hidden rounded-full bg-muted">
            <Image
              src="/logo.svg"
              alt="SailFuture Academy"
              fill
              className="object-cover"
            />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome to SailFuture Academy
            </h1>
            <p className="text-muted-foreground mt-2 text-base">
              Let&apos;s get your family set up to begin the registration
              process. This will only take a moment.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create Your Family</CardTitle>
            <CardDescription>
              Enter the primary parent or guardian&rsquo;s name and your
              home address to get started.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="first_name">First Name</FieldLabel>
                  <Input
                    id="first_name"
                    placeholder="Jane"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="last_name">Last Name</FieldLabel>
                  <Input
                    id="last_name"
                    placeholder="Walsh"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </Field>
              </div>
              <FieldDescription>
                Your family record will be created as &ldquo;
                {lastName ? `${lastName} Family` : "(your last name) Family"}
                &rdquo;.
              </FieldDescription>

              <Field>
                <FieldLabel htmlFor="address_line_1">
                  Street Address
                </FieldLabel>
                <Input
                  id="address_line_1"
                  placeholder="123 Main Street"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="address_line_2">
                  Apartment, Suite, etc.
                </FieldLabel>
                <FieldDescription>Optional</FieldDescription>
                <Input
                  id="address_line_2"
                  placeholder="Apt 4B"
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                />
              </Field>

              <div className="grid grid-cols-6 gap-4">
                <div className="col-span-3">
                  <Field>
                    <FieldLabel htmlFor="city">City</FieldLabel>
                    <Input
                      id="city"
                      placeholder="St. Petersburg"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="col-span-3">
                  <Field>
                    <FieldLabel>State</FieldLabel>
                    <StateSelect value={state} onChange={setState} />
                  </Field>
                </div>
              </div>

              <Field>
                <FieldLabel htmlFor="zip">Zip Code</FieldLabel>
                <Input
                  id="zip"
                  placeholder="33701"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                />
              </Field>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? "Creating..." : "Get Started"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
