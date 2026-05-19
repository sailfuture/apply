"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  digitsOnly,
  formatPhoneInputProgress,
  formatUSPhone,
  validateUSPhone,
  type PhoneValidation,
} from "@/lib/phone";

/**
 * US-only phone input with progressive formatting + validation.
 *
 * Behavior:
 *   - The user types; the component progressively reformats to
 *     `(813) 555-0123` as digits arrive.
 *   - The visible string is presentational. The `value` /
 *     `onChange` contract is the canonical 10-digit storage form
 *     (e.g. `"8135550123"`), so parent components don't have to
 *     parse formatting back out.
 *   - Pasted input (full numbers with country code, dashes, etc.)
 *     is normalized on the fly — `+1 (813) 555-0123` becomes the
 *     same `8135550123` value.
 *   - The input refuses to accept more than 10 digits — typing
 *     past the cap is a no-op.
 *   - On blur, an inline validation error renders under the
 *     input if the entered value isn't a valid US number. The
 *     `onValidate` callback (when provided) fires with the full
 *     `PhoneValidation` result so the parent form can disable a
 *     submit button or surface a combined error elsewhere.
 *
 * The component intentionally only enforces *format*. Required-
 * ness (i.e. "must not be empty") is the parent form's call —
 * pass `required` on the underlying input separately if needed.
 */
export interface PhoneInputProps {
  /** Canonical 10-digit storage value. Empty string when unset. */
  value: string;
  /** Called with the canonical 10-digit value on every keystroke
   *  (or empty string when cleared). Never receives the formatted
   *  display string — that lives inside the component. */
  onChange: (digits: string) => void;
  /** Optional listener for the full validation result. Fires on
   *  blur. Useful for form-level submit gating. */
  onValidate?: (result: PhoneValidation) => void;
  placeholder?: string;
  /** Marks the field with the standard `required` HTML attribute.
   *  The component itself doesn't enforce non-empty validation —
   *  pair this with a `required` prop on the form to get the
   *  browser-native "please fill out" message, or check
   *  `validateUSPhone(value).digits.length === 10` in submit
   *  handlers. */
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  autoComplete?: string;
  /** Extra classes spread onto the inner Input. */
  className?: string;
  /** Optional ARIA describedby pointer for the error caption. */
  "aria-describedby"?: string;
}

/**
 * Controlled phone input. Stores the formatted display in local
 * state so the on-screen text stays readable while the parent only
 * sees the raw digits.
 */
export function PhoneInput({
  value,
  onChange,
  onValidate,
  placeholder = "(555) 555-5555",
  required,
  disabled,
  id,
  name,
  autoComplete = "tel",
  className,
  "aria-describedby": describedBy,
}: PhoneInputProps) {
  // Display is the formatted version of `value`. Re-sync only when
  // the canonical value actually drifts from what we're displaying
  // — guards against the round-trip clobber where typing fires
  // onChange → parent re-renders with the new value prop → this
  // effect would re-run and call setDisplay(formatUSPhone(value)),
  // which returns the raw digit string for partial inputs (only
  // formats at exactly 10 digits). That clobbered the progressive
  // "(813) 555-…" formatting mid-type and caused cursor jumps /
  // selection flicker on every keystroke.
  const [display, setDisplay] = useState(() => formatUSPhone(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const currentDigits = digitsOnly(display);
    if (currentDigits !== value) {
      setDisplay(formatUSPhone(value));
    }
    // `display` deliberately excluded from deps — re-running on
    // every display change would defeat the purpose of the guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = useCallback(
    (raw: string) => {
      // Clear any prior error eagerly — the user is actively
      // typing, so we shouldn't leave the previous validation
      // message hanging.
      setError(null);
      const formatted = formatPhoneInputProgress(raw);
      setDisplay(formatted);
      // Strip down to the canonical digits and push to the
      // parent. Drops the country-code prefix if the user pasted
      // a full international form.
      let d = digitsOnly(formatted);
      if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
      onChange(d);
    },
    [onChange]
  );

  const handleBlur = useCallback(() => {
    if (display.trim().length === 0) {
      // Empty is allowed at the component level. Parent form
      // owns required-ness.
      onValidate?.({ valid: true, digits: "", error: null });
      return;
    }
    const result = validateUSPhone(display);
    setError(result.valid ? null : result.error);
    onValidate?.(result);
  }, [display, onValidate]);

  const captionId =
    error && id ? `${id}-error` : describedBy;

  return (
    <>
      <Input
        type="tel"
        inputMode="tel"
        value={display}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        id={id}
        name={name}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={captionId}
        // 16 characters covers the widest formatted form: "+1
        // (XXX) XXX-XXXX" = 17, but the internal formatter never
        // emits the +1 prefix so 14 is the actual ceiling. Set
        // slightly higher just to give pasted strings room to
        // settle before the formatter trims them.
        maxLength={16}
        className={cn(className)}
      />
      {error ? (
        <p
          id={captionId}
          className="mt-1 text-xs text-red-600"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
