/**
 * Registration-phase year overview.
 *
 * This is a thin re-export of the application-phase year overview page —
 * we want the URL to read `/registration/year/[yearId]` for families who
 * have been accepted (and are working through registration / pending
 * admin confirmation / enrolled), but the rendered content is identical.
 * The page itself branches between AcceptedView, RegistrationPendingView,
 * and EnrolledFamilyDashboard based on the family's stage data.
 */
export { default } from "@/app/(dashboard)/apply/year/[yearId]/page";
