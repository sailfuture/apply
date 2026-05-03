/**
 * Re-application Family Details page.
 *
 * Re-export of the apply-flow family page. The page itself is flow-aware
 * (detects /reapply via pathname) and writes section completion to the
 * reapply progress row's `isFamilyDetails` bool instead of the apply
 * progress row's `family_completed`. All editing logic, validation, and
 * UI carry over identically.
 */
export { default } from "@/app/(dashboard)/apply/year/[yearId]/family/page";
