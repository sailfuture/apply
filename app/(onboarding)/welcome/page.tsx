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
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { US_STATES } from "@/lib/us-states";

export default function WelcomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [familyName, setFamilyName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");

  useEffect(() => {
    async function checkFamily() {
      try {
        const res = await fetch("/api/families");
        if (res.ok) {
          const data = await res.json();
          if (data?.id) {
            router.replace("/");
            return;
          }
        }
      } catch {
        // continue to show welcome
      }
      setLoading(false);
    }
    checkFamily();
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
          family_name: familyName,
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
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
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
              Enter your family name and home address to get started.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <Field>
                <FieldLabel htmlFor="family_name">Family Name</FieldLabel>
                <Input
                  id="family_name"
                  placeholder='e.g. "The Walsh Family"'
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  required
                />
              </Field>

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
                    <Combobox
                      value={state}
                      onValueChange={(val) => setState(val as string)}
                    >
                      <ComboboxInput
                        placeholder="Search state..."
                        className="w-full"
                      />
                      <ComboboxContent>
                        <ComboboxList>
                          {US_STATES.map((s) => (
                            <ComboboxItem
                              key={s.value}
                              value={s.value}
                            >
                              {s.label}
                            </ComboboxItem>
                          ))}
                        </ComboboxList>
                        <ComboboxEmpty>No state found</ComboboxEmpty>
                      </ComboboxContent>
                    </Combobox>
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
