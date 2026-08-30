import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — SailFuture Academy",
  description:
    "Terms of Service for the SailFuture Academy family registration portal, including the SMS text messaging program terms.",
};

/**
 * Public Terms of Service page. Linked from the SMS opt-in block on
 * the /welcome onboarding form and referenced by the Twilio A2P 10DLC
 * campaign registration, so it MUST stay publicly reachable (listed in
 * the middleware's public routes — see proxy.ts) and must keep the SMS
 * program section: message categories, frequency, rates, HELP/STOP,
 * and the no-consent-required statement.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: August 30, 2026
      </p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-foreground/90">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">1. About this service</h2>
          <p>
            This website is the family registration and enrollment portal
            for SailFuture Academy (&ldquo;SailFuture,&rdquo;
            &ldquo;we,&rdquo; &ldquo;us&rdquo;). By creating an account or
            using the portal, you agree to these Terms of Service. The
            portal is intended for parents and guardians managing a
            student&rsquo;s application, enrollment, and tuition with
            SailFuture Academy.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">2. Your account</h2>
          <p>
            You are responsible for the accuracy of the information you
            provide and for keeping your sign-in credentials secure.
            Please notify us promptly if you believe your account has
            been accessed without authorization.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            3. SMS text messaging program
          </h2>
          <p>
            With your consent, SailFuture Academy sends automated text
            messages about your student&rsquo;s application and
            enrollment, tuition and payment activity, school events, and
            other important updates.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium">Opt-in.</span> You opt in by
              providing your mobile phone number and actively checking
              the consent box during registration. Consent is not
              required to enroll a student or to make any purchase.
            </li>
            <li>
              <span className="font-medium">Message frequency.</span>{" "}
              Message frequency varies based on your student&rsquo;s
              application and enrollment activity.
            </li>
            <li>
              <span className="font-medium">Fees.</span> Message and data
              rates may apply depending on your mobile phone service
              plan. Contact your wireless provider for details about
              your plan.
            </li>
            <li>
              <span className="font-medium">Opt-out.</span> Reply{" "}
              <span className="font-medium">STOP</span> to any message to
              cancel at any time. After you opt out, you will receive one
              final message confirming the cancellation. You can also ask
              our staff to opt you out.
            </li>
            <li>
              <span className="font-medium">Help.</span> Reply{" "}
              <span className="font-medium">HELP</span> to any message for
              assistance, or contact us at{" "}
              <a
                href="mailto:admissions@sailfuture.org"
                className="text-primary underline underline-offset-2"
              >
                admissions@sailfuture.org
              </a>
              .
            </li>
            <li>
              <span className="font-medium">Carriers.</span> Wireless
              carriers are not liable for delayed or undelivered
              messages.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">4. Privacy</h2>
          <p>
            Our{" "}
            <a
              href="/privacy"
              className="text-primary underline underline-offset-2"
            >
              Privacy Policy
            </a>{" "}
            describes how we collect and use your information, including
            your mobile phone number and text messaging consent.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">5. Changes</h2>
          <p>
            We may update these terms from time to time. The &ldquo;Last
            updated&rdquo; date above reflects the most recent revision.
            Continued use of the portal after a change constitutes
            acceptance of the updated terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">6. Contact</h2>
          <p>
            SailFuture Academy, St. Petersburg, Florida. Questions about
            these terms:{" "}
            <a
              href="mailto:admissions@sailfuture.org"
              className="text-primary underline underline-offset-2"
            >
              admissions@sailfuture.org
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
