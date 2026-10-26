import { FinancialAidStep } from "@/components/financial-aid-step";

/**
 * Apply flow → Financial Aid. The step itself lives in
 * `components/financial-aid-step.tsx` so the dashboard's mid-year
 * "Add Student" flow can render the same family scholarship + per-student
 * SUFS view for one added student.
 */
export default function ScholarshipPage() {
  return <FinancialAidStep />;
}
