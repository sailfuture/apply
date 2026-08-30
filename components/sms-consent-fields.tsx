"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";

/**
 * A2P 10DLC-compliant SMS opt-in block — phone number + express-consent
 * checkbox + the carrier-required disclosures (frequency, rates,
 * HELP/STOP, Terms + Privacy links).
 *
 * Rendered in two places that must never drift:
 *   - the /welcome onboarding form (live, wired to state), where the
 *     consent is actually captured during parent registration;
 *   - the public /sms-opt-in page (static), which exists so the Twilio
 *     campaign "Message Flow" field has a publicly reachable URL
 *     showing the exact opt-in language — the live form sits behind
 *     Clerk auth, which campaign reviewers can't get past.
 *
 * Compliance notes baked into the markup: the checkbox is NEVER
 * pre-checked, consent is explicitly not a condition of enrollment,
 * and the disclosure text names the message categories (application/
 * enrollment, billing, school updates) that the app actually sends.
 */
export function SmsConsentFields({
  phone = "",
  onPhoneChange,
  consented,
  onConsentChange,
  staticExample = false,
  showPhone = true,
}: {
  phone?: string;
  onPhoneChange?: (value: string) => void;
  consented: boolean;
  onConsentChange?: (value: boolean) => void;
  /** Render as the non-interactive public example (inputs disabled). */
  staticExample?: boolean;
  /** Hide the phone input when the host form already renders its own
   *  phone field directly above (the apply-flow parent card). */
  showPhone?: boolean;
}) {
  return (
    <div className="space-y-4">
      {showPhone ? (
        <Field>
          <FieldLabel htmlFor="sms-phone">Mobile Phone Number</FieldLabel>
          <Input
            id="sms-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => onPhoneChange?.(e.target.value)}
            disabled={staticExample}
            required={!staticExample}
          />
        </Field>
      ) : null}

      <label
        htmlFor="sms-consent"
        className="flex items-start gap-3 cursor-pointer"
      >
        <Checkbox
          id="sms-consent"
          checked={consented}
          onCheckedChange={(v) => onConsentChange?.(v === true)}
          disabled={staticExample}
          className="mt-0.5"
        />
        <span className="text-sm leading-relaxed">
          Yes, I would like to receive automated text messages from
          SailFuture Academy about my student&rsquo;s application and
          enrollment, tuition and payment activity, school events, and
          other important updates.
        </span>
      </label>

      <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
        <p>
          <span className="font-medium text-foreground">
            Message Frequency:
          </span>{" "}
          Message frequency varies based on your student&rsquo;s
          application and enrollment activity.
        </p>
        <p>
          <span className="font-medium text-foreground">
            Standard Rates:
          </span>{" "}
          Message and data rates may apply depending on your mobile
          phone service plan.
        </p>
        <p>
          <span className="font-medium text-foreground">Help &amp; Stop:</span>{" "}
          Reply HELP for help or STOP to cancel at any time. By providing
          your phone number and checking the box above, you agree to
          receive text messages from SailFuture Academy. Consent is not
          required to enroll.
        </p>
        <p>
          <a
            href="/terms"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            Terms of Service
          </a>{" "}
          |{" "}
          <a
            href="/privacy"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
