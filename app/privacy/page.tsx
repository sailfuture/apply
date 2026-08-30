import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — SailFuture Academy",
  description:
    "Privacy Policy for the SailFuture Academy family registration portal, including how mobile phone numbers and SMS consent are handled.",
};

/**
 * Public Privacy Policy page. Linked from the SMS opt-in block on the
 * /welcome onboarding form and referenced by the Twilio A2P 10DLC
 * campaign registration, so it MUST stay publicly reachable (listed in
 * the middleware's public routes — see proxy.ts). Carrier vetting
 * specifically checks for the statement that mobile numbers and SMS
 * opt-in consent are not shared with third parties for marketing —
 * keep that section intact.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: August 30, 2026
      </p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-foreground/90">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">1. What we collect</h2>
          <p>
            The SailFuture Academy family registration portal collects
            the information parents and guardians provide while applying
            for and managing a student&rsquo;s enrollment: names, contact
            details (email, mailing address, mobile phone number),
            student and household information required for admission and
            scholarship processing, uploaded documents, and tuition
            payment records.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">2. How we use it</h2>
          <p>
            We use this information to process applications, manage
            enrollment and scholarships, bill tuition, and communicate
            with your family about your student — including by email and,
            with your consent, by text message. Payment card details are
            processed by Stripe; we never store card numbers on our own
            systems.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            3. Text messaging and your phone number
          </h2>
          <p>
            If you opt in to text messages, we use your mobile phone
            number to send automated messages about your student&rsquo;s
            application and enrollment, tuition and payment activity,
            school events, and other important updates.
          </p>
          <p className="font-medium">
            We do not share, sell, or rent your mobile phone number or
            your text messaging opt-in consent with any third party or
            affiliate for their marketing or promotional purposes. Text
            messaging originator opt-in data and consent are not shared
            with third parties.
          </p>
          <p>
            You can withdraw consent at any time by replying STOP to any
            message or by contacting our staff.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">4. Sharing</h2>
          <p>
            We share information only as needed to operate the school and
            the services described above — for example with our payment
            processor (Stripe), our messaging provider (Twilio), document
            signature and scholarship processing partners, and state
            scholarship programs (such as Step Up For Students) when your
            family participates in them. These providers process data on
            our behalf and are not permitted to use it for their own
            marketing.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">5. Retention and security</h2>
          <p>
            We retain family and student records as required for school
            administration and applicable law, and we restrict access to
            staff who need it for their role. Contact us if you would
            like to review or correct information we hold about your
            family.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">6. Contact</h2>
          <p>
            SailFuture Academy, St. Petersburg, Florida. Privacy
            questions:{" "}
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
