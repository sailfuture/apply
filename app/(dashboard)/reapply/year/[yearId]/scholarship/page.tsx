/**
 * Re-application Opportunity Scholarship page.
 *
 * Re-export of the apply-flow scholarship page. The page is flow-aware
 * and writes to the reapply progress row's `isScholarship` bool when
 * mounted under /reapply. All OS form logic, hooks, and UI carry over —
 * the per-year `useScholarship(familyId, yearId)` hook fetches/creates a
 * fresh scholarship row for the new year.
 */
export { default } from "@/app/(dashboard)/apply/year/[yearId]/scholarship/page";
