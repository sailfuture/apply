"use client";

import { useUser } from "@clerk/nextjs";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

export default function AccountPage() {
  const { user, isLoaded } = useUser();

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
              <BreadcrumbLink href="/account">Settings</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Account</BreadcrumbPage>
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

  if (!user) {
    return (
      <>
        {pageHeader}
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">Not signed in.</p>
        </div>
      </>
    );
  }

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || "—";
  const primaryEmail = user.primaryEmailAddress?.emailAddress ?? "";
  const primaryPhone = user.primaryPhoneNumber?.phoneNumber ?? "";
  const initials =
    (user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "");
  const createdAt = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  return (
    <>
      {pageHeader}
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold">Account</h1>
          <p className="text-muted-foreground mt-1">
            Your profile and account details.
          </p>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 rounded-lg">
                  <AvatarImage src={user.imageUrl} alt={fullName} />
                  <AvatarFallback className="rounded-lg text-lg">
                    {initials || "U"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle>{fullName}</CardTitle>
                  <CardDescription>{primaryEmail}</CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Details from your Clerk account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                <InfoRow label="First Name" value={user.firstName ?? ""} />
                <InfoRow label="Last Name" value={user.lastName ?? ""} />
                <InfoRow label="Email" value={primaryEmail} />
                <InfoRow label="Phone" value={primaryPhone} />
                <InfoRow label="Member Since" value={createdAt} />
                <InfoRow label="Clerk User ID" value={user.id} />
              </div>
            </CardContent>
          </Card>

          {user.emailAddresses.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Email Addresses</CardTitle>
                <CardDescription>
                  All email addresses linked to your account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {user.emailAddresses.map((email) => (
                    <div
                      key={email.id}
                      className="bg-muted/50 flex items-center justify-between rounded-lg border px-4 py-3"
                    >
                      <p className="text-sm font-medium">
                        {email.emailAddress}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          email.id === user.primaryEmailAddressId
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {email.id === user.primaryEmailAddressId
                          ? "Primary"
                          : "Secondary"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {user.phoneNumbers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Phone Numbers</CardTitle>
                <CardDescription>
                  Phone numbers linked to your account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {user.phoneNumbers.map((phone) => (
                    <div
                      key={phone.id}
                      className="bg-muted/50 flex items-center justify-between rounded-lg border px-4 py-3"
                    >
                      <p className="text-sm font-medium">
                        {phone.phoneNumber}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          phone.id === user.primaryPhoneNumberId
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {phone.id === user.primaryPhoneNumberId
                          ? "Primary"
                          : "Secondary"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
