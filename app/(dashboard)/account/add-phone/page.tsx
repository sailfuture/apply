"use client";

import * as React from "react";
import { useUser } from "@clerk/nextjs";
import { PhoneNumberResource } from "@clerk/types";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export default function AddPhonePage() {
  const { isLoaded, user } = useUser();
  const router = useRouter();
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [isVerifying, setIsVerifying] = React.useState(false);
  const [successful, setSuccessful] = React.useState(false);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [phoneObj, setPhoneObj] = React.useState<
    PhoneNumberResource | undefined
  >();

  const pageHeader = (
    <header className="flex h-16 shrink-0 items-center gap-2">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/account">Account</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Add Phone</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );

  if (!isLoaded) {
    return (
      <>
        {pageHeader}
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await user!.createPhoneNumber({ phoneNumber: phone });
      await user!.reload();

      const phoneNumber = user!.phoneNumbers.find((p) => p.id === res?.id);
      setPhoneObj(phoneNumber);

      await phoneNumber?.prepareVerification();
      setIsVerifying(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to add phone number. Make sure it's in the correct format (e.g. +1 555 123 4567).";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await phoneObj?.attemptVerification({ code });
      if (result?.verification.status === "verified") {
        setSuccessful(true);
        setTimeout(() => router.push("/account"), 1500);
      } else {
        setError("Verification failed. Please try again.");
      }
    } catch {
      setError("Invalid code. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (successful) {
    return (
      <>
        {pageHeader}
        <div className="mx-auto max-w-lg px-4 py-12">
          <Card>
            <CardHeader>
              <CardTitle>Phone Added</CardTitle>
              <CardDescription>
                Your phone number has been verified and added to your account.
                Redirecting...
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </>
    );
  }

  if (isVerifying) {
    return (
      <>
        {pageHeader}
        <div className="mx-auto max-w-lg px-4 py-12">
          <Card>
            <CardHeader>
              <CardTitle>Verify Your Phone</CardTitle>
              <CardDescription>
                Enter the verification code sent to your phone.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleVerify}>
              <CardContent>
                <div className="grid gap-2">
                  <Label htmlFor="code">Verification Code</Label>
                  <Input
                    id="code"
                    placeholder="Enter code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </div>
              </CardContent>
              <CardFooter className="flex items-center gap-3">
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Verifying..." : "Verify"}
                </Button>
                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}
              </CardFooter>
            </form>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      {pageHeader}
      <div className="mx-auto max-w-lg px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Add Phone Number</CardTitle>
            <CardDescription>
              Add a phone number to your account. You&apos;ll receive a
              verification code via SMS.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent>
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="flex items-center gap-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Sending code..." : "Continue"}
              </Button>
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
            </CardFooter>
          </form>
        </Card>
      </div>
    </>
  );
}
