import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SmsConsentFields } from "@/components/sms-consent-fields";

export const metadata: Metadata = {
  title: "SMS Opt-In — SailFuture Academy",
  description:
    "The text message opt-in form SailFuture Academy families complete during account registration.",
  robots: { index: false },
};

/**
 * Public, non-interactive replica of the SMS opt-in block from the
 * /welcome onboarding form. The real form sits behind Clerk auth,
 * which Twilio's A2P 10DLC campaign reviewers can't get past — this
 * page gives the campaign's "Message Flow" field a publicly reachable
 * URL showing the exact opt-in language (instead of hosting a
 * screenshot on Drive). Shares the SmsConsentFields component with
 * the live form so the vetted language can't drift.
 */
export default function SmsOptInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-lg space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-center text-lg">
              SailFuture Academy Text Alert Subscription
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <StaticConsentBlock />
            <Button type="button" className="w-full" disabled>
              Yes, sign me up!
            </Button>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          This is a preview of the opt-in step parents complete while
          creating their SailFuture Academy family account on this
          registration portal. The live form requires a signed-in
          parent account.
        </p>
      </div>
    </div>
  );
}

function StaticConsentBlock() {
  return (
    <SmsConsentFields
      phone=""
      consented={false}
      staticExample
    />
  );
}
