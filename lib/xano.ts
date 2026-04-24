const BASE_URL = process.env.XANO_API_BASE_URL;

function getBaseUrl() {
  if (!BASE_URL) throw new Error("XANO_API_BASE_URL is not configured");
  return BASE_URL;
}

export interface XanoParent {
  id: number;
  created_at: number;
  clerk_user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  invite_status: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
}

export interface XanoFamily {
  id: number;
  created_at: number;
  family_name: string;
  bus_transportation: boolean;
  isAccepted: boolean;
  isSubmitted: boolean;
  registration_students_id: (number | Record<string, unknown> | unknown[])[];
  registration_parents_id: (number | Record<string, unknown> | unknown[])[];
  registration_fee_waiver_id: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractIds(items: any[]): number[] {
  return items
    .filter((item) => item != null && !(Array.isArray(item) && item.length === 0))
    .map((item) => (typeof item === "number" ? item : item?.id))
    .filter((id): id is number => typeof id === "number");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractParents(items: any[]): XanoParent[] {
  return items.filter(
    (item): item is XanoParent =>
      item != null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof item.id === "number"
  );
}

export interface XanoStudent {
  id: number;
  created_at: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
  photo: string | null;
  registration_families_id: number;
  registration_school_years_id: number[];
  isArchived: boolean;
  isAccepted: boolean;
}

export interface XanoApplication {
  id: number;
  created_at: number;
  registration_students_id: number;
  registration_families_id: number;
  registration_application_status_id: number;
  registration_school_years_id: number;
  registration_parents_id: number;
  type: string;
  current_previous_school: string;
  describe_student_opportunities_for_growth: string;
  describe_student_strengths: string;
  sufs_type: string;
  sufs_status: string;
  sufs_award_id: number;
  is_bus_transportation: boolean;
  bus_stop: string;
  test_scores: Record<string, unknown> | null;
  nwea_testing_complete: boolean;
  nwea_testing_scheduled: boolean;
  last_grade_completed: string;
  current_grade: string;
  isSubmitted: boolean;
  isOffered: boolean;
  isAccepted: boolean;
  opportunity_scholarship_award_amount: number;
}

export interface XanoApplicationStatus {
  id: number;
  created_at: number;
  status_name: string;
}

export interface XanoSchoolYear {
  id: number;
  created_at: number;
  year_name: string;
  start_date: string | null;
  end_date: string | null;
  tuition: number;
  annual_fees: number;
  transportation_fees: number;
  fes_eo_9: number;
  fes_eo_8: number;
  ftc_8: number;
  ftc_9: number;
  fes_ua_8_ese_1_3: number;
  fes_ua_9_ese_1_3: number;
  fes_ua_ese_4: number;
  fes_ua_ese_5: number;
  opportunity_scholarship_award: number;
  isActive: boolean;
  isPast: boolean;
  isNextYear: boolean;
  isFuture: boolean;
  application_deadline: string | null;
  opportunity_scholarship_deadline: string | null;
}

export interface XanoFamilyPayment {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  isFamilyAccepted: boolean;
  signature: Record<string, unknown>;
  name: string;
  signature_data: Record<string, unknown> | null;
  registration_fee_waiver_id: number | null;
  monthly_tuition_payment: number;
  tuition_reviewed: boolean;
  tuition_reviewed_at: number | null;
  tuition_reviewed_by: string;
  enrollment_agreement_pandadoc_id: string;
  enrollment_agreement_status: string;
  enrollment_agreement_sent_at: string | null;
  enrollment_agreement_pdf_url: string;
  is_enrollment_agreement_signed: boolean;
}

export interface XanoScholarship {
  id: number;
  created_at: number;
  registration_families_id: number;
  registration_school_years_id: number;
  household_adults: number;
  household_children: number;
  no_contributing_member: boolean;
  business_income_monthly: number;
  capital_gains_monthly: number;
  child_support_monthly: number;
  alimony_monthly: number;
  trusts_monthly: number;
  other_income_monthly: number;
  describe_other_income: string;
  assets_checking: number;
  assets_savings: number;
  assets_retirement_savings: number;
  assets_stocks_bonds_securities: number;
  assets_trusts_inheritance: number;
  assets_business: number;
  debts_credit_cards: number;
  debts_student_loans: number;
  debts_personal_loans: number;
  government_benefits: boolean;
  snap_benefits: Record<string, unknown>[];
  other_benefits: Record<string, unknown>[];
  family_contribution_per_month: number;
  scholarship_advocacy_letter: string;
  signature: Record<string, unknown> | null;
  termination_letter: Record<string, unknown> | null;
  last_edited: number | null;
  isNotParticipating: boolean;
  isSNAPBenefits: boolean;
  isOpportunityScholarship: boolean;
}

export interface XanoScholarshipBenefit {
  id: number;
  created_at: number;
  registration_opportunity_scholarship_id: number;
  type: string;
  amount_monthly: number;
}

export interface XanoScholarshipContributingMember {
  id: number;
  created_at: number;
  registration_opportunity_scholarship_id: number;
  first_name: string;
  last_name: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  zipcode: string;
  estimated_annual_income: number;
  isW2: boolean;
  isPayStubs: boolean;
  w2: Record<string, unknown> | null;
  paystub_1: Record<string, unknown> | null;
  paystub_2: Record<string, unknown> | null;
  paystub_3: Record<string, unknown> | null;
  paystub_4: Record<string, unknown> | null;
}

export interface XanoScholarshipHome {
  id: number;
  created_at: number;
  registration_opportunity_scholarship_id: number;
  type: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  zipcode: string;
  total_value: number;
  outstanding_debt: number;
}

export interface XanoScholarshipVehicle {
  id: number;
  created_at: number;
  registration_opportunity_scholarship_id: number;
  type: string;
  car_make: string;
  car_model: string;
  car_year: string;
  total_value: number;
  remaining_debt: number;
}

export interface XanoBusStop {
  id: number;
  created_at: number;
  name: string;
  pick_up_time: number;
  drop_off_time: number;
  address: string;
}

export interface XanoAdmin {
  id: number;
  created_at: number;
  clerk_user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
}

export interface XanoInquiry {
  id: number;
  created_at: number;
  primary_first_name: string;
  primary_last_name: string;
  primary_email: string;
  primary_phone: number;
  student_first_name: string;
  student_last_name: string;
  current_grade: string;
  starting_grade: string;
  previous_school: string;
  about_student: string;
  hear_about_us: string;
  messaging_opt_in: boolean;
}

export interface XanoEmergencyContact {
  id: number;
  created_at: number;
  registration_families_id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
}

export interface XanoStudentRegistration {
  id: number;
  created_at: number;
  registration_students_id: number;
  shirt_size: string;
  pant_size: string;
  swim_level: string;
  birth_certificate: Record<string, unknown>;
  school_health_form: Record<string, unknown>;
  transcripts: Record<string, unknown>;
  iep: Record<string, unknown>;
  ssn_card: Record<string, unknown>;
  immunization_forms: Record<string, unknown>;
  passport: Record<string, unknown>;
  immunization_form: Record<string, unknown>;
  student_state_id: Record<string, unknown>;
  allergies: string;
  iep_description: string;
  dietary_restrictions: string;
  prescription_medications: string;
  health_conditions: string;
  vision_impairments: string;
  hearing_impairments: string;
  is_student_on_medicaid: boolean;
  medicaid_number: number;
  medicaid_provider: string;
  carry_epi_pen: boolean;
  epipen_explainer: string;
  permission_for_acetaminophen: string;
  additional_health_information: string;
  interested_in_counseling_services: string;
  other_adults_approved_for_pickup: string;
  prohibited_adults: string;
  liability_waiver_pandadoc_id: string;
  liability_waiver_status: string;
  liability_wavier_sent_at: string | null;
  liability_waiver_pdf_url: string;
}

const pendingEnsure = new Map<string, Promise<XanoParent>>();

export function ensureParentRecord(
  clerkUserId: string,
  clerkUser: {
    firstName?: string | null;
    lastName?: string | null;
    primaryEmailAddress?: { emailAddress: string } | null;
    primaryPhoneNumber?: { phoneNumber: string } | null;
  }
): Promise<XanoParent> {
  const inflight = pendingEnsure.get(clerkUserId);
  if (inflight) return inflight;

  const promise = _doEnsureParentRecord(clerkUserId, clerkUser).finally(() => {
    pendingEnsure.delete(clerkUserId);
  });
  pendingEnsure.set(clerkUserId, promise);
  return promise;
}

async function _doEnsureParentRecord(
  clerkUserId: string,
  clerkUser: {
    firstName?: string | null;
    lastName?: string | null;
    primaryEmailAddress?: { emailAddress: string } | null;
    primaryPhoneNumber?: { phoneNumber: string } | null;
  }
): Promise<XanoParent> {
  const email = clerkUser.primaryEmailAddress?.emailAddress ?? "";
  const rawPhone = clerkUser.primaryPhoneNumber?.phoneNumber ?? "";
  const cleanPhone = rawPhone.replace(/\D/g, "");

  const existing = await xano.parents.findByClerkId(clerkUserId);
  if (existing) {
    const updates: Partial<Omit<XanoParent, "id" | "created_at">> = {};
    if (clerkUser.firstName && clerkUser.firstName !== existing.first_name)
      updates.first_name = clerkUser.firstName;
    if (clerkUser.lastName && clerkUser.lastName !== existing.last_name)
      updates.last_name = clerkUser.lastName;
    if (email && email !== existing.email) updates.email = email;
    if (cleanPhone && cleanPhone !== existing.phone)
      updates.phone = cleanPhone;

    if (Object.keys(updates).length > 0) {
      return await xano.parents.update(existing.id, updates);
    }
    return existing;
  }

  const pendingParent = email ? await xano.parents.findByEmail(email) : null;

  if (pendingParent && pendingParent.invite_status === "pending") {
    return await xano.parents.update(pendingParent.id, {
      clerk_user_id: clerkUserId,
      first_name: clerkUser.firstName ?? pendingParent.first_name,
      last_name: clerkUser.lastName ?? pendingParent.last_name,
      phone: cleanPhone || pendingParent.phone,
      invite_status: "active",
    });
  }

  return await xano.parents.create({
    clerk_user_id: clerkUserId,
    first_name: clerkUser.firstName ?? "",
    last_name: clerkUser.lastName ?? "",
    email,
    phone: cleanPhone,
    relationship: "",
    invite_status: "active",
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    zipcode: "",
  });
}

export const xano = {
  parents: {
    async create(data: Omit<XanoParent, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_parents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoParent>;
    },

    async getAll(): Promise<XanoParent[]> {
      const res = await fetch(`${getBaseUrl()}/registration_parents`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoParent> {
      const res = await fetch(`${getBaseUrl()}/registration_parents/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoParent, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_parents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoParent>;
    },

    async findByClerkId(clerkUserId: string): Promise<XanoParent | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_parents?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          // Fallback to full scan if query param not supported
          const all = await this.getAll();
          return all.find((p) => p.clerk_user_id === clerkUserId) ?? null;
        }
        const results: XanoParent[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find((p) => p.clerk_user_id === clerkUserId) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find((p) => p.clerk_user_id === clerkUserId) ?? null;
      }
    },

    async findByEmail(email: string): Promise<XanoParent | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_parents?email=${encodeURIComponent(email)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.find((p) => p.email === email) ?? null;
        }
        const results: XanoParent[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find((p) => p.email === email) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find((p) => p.email === email) ?? null;
      }
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_parents/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  families: {
    async create(data: Omit<XanoFamily, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_families`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoFamily>;
    },

    async getAll(): Promise<XanoFamily[]> {
      const res = await fetch(`${getBaseUrl()}/registration_families`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoFamily> {
      const res = await fetch(`${getBaseUrl()}/registration_families/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoFamily, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_families/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoFamily>;
    },

    async findByParentId(parentId: number): Promise<XanoFamily | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_families?registration_parents_id=${parentId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.find((f) => extractIds(f.registration_parents_id).includes(parentId)) ?? null;
        }
        const results: XanoFamily[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find((f) => extractIds(f.registration_parents_id).includes(parentId)) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find((f) => extractIds(f.registration_parents_id).includes(parentId)) ?? null;
      }
    },

    getParentIds(family: XanoFamily): number[] {
      return extractIds(family.registration_parents_id);
    },

    getEmbeddedParents(family: XanoFamily): XanoParent[] {
      return extractParents(family.registration_parents_id);
    },

    getStudentIds(family: XanoFamily): number[] {
      return extractIds(family.registration_students_id);
    },
  },

  students: {
    async create(data: Omit<XanoStudent, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoStudent>;
    },

    async getAll(): Promise<XanoStudent[]> {
      const res = await fetch(`${getBaseUrl()}/registration_students`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoStudent> {
      const res = await fetch(`${getBaseUrl()}/registration_students/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoStudent, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_students/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoStudent>;
    },

    async getByFamilyId(familyId: number): Promise<XanoStudent[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_students?registration_families_id=${familyId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((s) => s.registration_families_id === familyId && !s.isArchived);
        }
        const results: XanoStudent[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.filter((s) => s.registration_families_id === familyId && !s.isArchived);
      } catch {
        const all = await this.getAll();
        return all.filter((s) => s.registration_families_id === familyId && !s.isArchived);
      }
    },
  },

  applications: {
    async create(data: Omit<XanoApplication, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_application`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoApplication>;
    },

    async getAll(): Promise<XanoApplication[]> {
      const res = await fetch(`${getBaseUrl()}/registration_application`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoApplication> {
      const res = await fetch(`${getBaseUrl()}/registration_application/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoApplication, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_application/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoApplication>;
    },

    async getByFamilyId(familyId: number): Promise<XanoApplication[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_application?registration_families_id=${familyId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((a) => a.registration_families_id === familyId);
        }
        const results: XanoApplication[] = await res.json();
        return Array.isArray(results) ? results : [];
      } catch {
        const all = await this.getAll();
        return all.filter((a) => a.registration_families_id === familyId);
      }
    },

    async getByStudentAndYear(studentId: number, schoolYearId: number): Promise<XanoApplication | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_application?registration_students_id=${studentId}&registration_school_years_id=${schoolYearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.find(
            (a) => a.registration_students_id === studentId && a.registration_school_years_id === schoolYearId
          ) ?? null;
        }
        const results: XanoApplication[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find(
          (a) => a.registration_students_id === studentId && a.registration_school_years_id === schoolYearId
        ) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find(
          (a) => a.registration_students_id === studentId && a.registration_school_years_id === schoolYearId
        ) ?? null;
      }
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_application/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  applicationStatuses: {
    async getAll(): Promise<XanoApplicationStatus[]> {
      const res = await fetch(`${getBaseUrl()}/registration_application_status`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoApplicationStatus> {
      const res = await fetch(`${getBaseUrl()}/registration_application_status/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async findByName(name: string): Promise<XanoApplicationStatus | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_application_status?status_name=${encodeURIComponent(name)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.find((s) => s.status_name.toLowerCase() === name.toLowerCase()) ?? null;
        }
        const results: XanoApplicationStatus[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find((s) => s.status_name.toLowerCase() === name.toLowerCase()) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find((s) => s.status_name.toLowerCase() === name.toLowerCase()) ?? null;
      }
    },
  },

  schoolYears: {
    async getAll(): Promise<XanoSchoolYear[]> {
      const res = await fetch(`${getBaseUrl()}/registration_school_years`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoSchoolYear> {
      const res = await fetch(`${getBaseUrl()}/registration_school_years/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  scholarship: {
    async create(data: Omit<XanoScholarship, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarship>;
    },

    async getAll(): Promise<XanoScholarship[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getById(id: number): Promise<XanoScholarship> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoScholarship, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarship>;
    },

    async getByFamilyAndYear(familyId: number, yearId: number): Promise<XanoScholarship | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_opportunity_scholarship?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.find(
            (s) => s.registration_families_id === familyId && s.registration_school_years_id === yearId
          ) ?? null;
        }
        const results: XanoScholarship[] = await res.json();
        const items = Array.isArray(results) ? results : [];
        return items.find(
          (s) => s.registration_families_id === familyId && s.registration_school_years_id === yearId
        ) ?? null;
      } catch {
        const all = await this.getAll();
        return all.find(
          (s) => s.registration_families_id === familyId && s.registration_school_years_id === yearId
        ) ?? null;
      }
    },
  },

  scholarshipBenefits: {
    async create(data: Omit<XanoScholarshipBenefit, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_benefits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipBenefit>;
    },

    async getAll(): Promise<XanoScholarshipBenefit[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_benefits`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoScholarshipBenefit, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_benefits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipBenefit>;
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_benefits/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    async getByScholarshipId(scholarshipId: number): Promise<XanoScholarshipBenefit[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_opportunity_scholarship_benefits?registration_opportunity_scholarship_id=${scholarshipId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((b) => b.registration_opportunity_scholarship_id === scholarshipId);
        }
        const results: XanoScholarshipBenefit[] = await res.json();
        return Array.isArray(results) ? results : [];
      } catch {
        const all = await this.getAll();
        return all.filter((b) => b.registration_opportunity_scholarship_id === scholarshipId);
      }
    },
  },

  scholarshipContributingMembers: {
    async create(data: Omit<XanoScholarshipContributingMember, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipContributingMember>;
    },

    async getAll(): Promise<XanoScholarshipContributingMember[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoScholarshipContributingMember, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipContributingMember>;
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_contributing_members/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    async getByScholarshipId(scholarshipId: number): Promise<XanoScholarshipContributingMember[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_opportunity_scholarship_contributing_members?registration_opportunity_scholarship_id=${scholarshipId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((m) => m.registration_opportunity_scholarship_id === scholarshipId);
        }
        const results: XanoScholarshipContributingMember[] = await res.json();
        return Array.isArray(results) ? results : [];
      } catch {
        const all = await this.getAll();
        return all.filter((m) => m.registration_opportunity_scholarship_id === scholarshipId);
      }
    },
  },

  scholarshipHomes: {
    async create(data: Omit<XanoScholarshipHome, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_home`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipHome>;
    },

    async getAll(): Promise<XanoScholarshipHome[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_home`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoScholarshipHome, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_home/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipHome>;
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_home/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    async getByScholarshipId(scholarshipId: number): Promise<XanoScholarshipHome[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_opportunity_scholarship_home?registration_opportunity_scholarship_id=${scholarshipId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((h) => h.registration_opportunity_scholarship_id === scholarshipId);
        }
        const results: XanoScholarshipHome[] = await res.json();
        return Array.isArray(results) ? results : [];
      } catch {
        const all = await this.getAll();
        return all.filter((h) => h.registration_opportunity_scholarship_id === scholarshipId);
      }
    },
  },

  scholarshipVehicles: {
    async create(data: Omit<XanoScholarshipVehicle, "id" | "created_at">) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipVehicle>;
    },

    async getAll(): Promise<XanoScholarshipVehicle[]> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_vehicles`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoScholarshipVehicle, "id" | "created_at">>) {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_vehicles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json() as Promise<XanoScholarshipVehicle>;
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_opportunity_scholarship_vehicles/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },

    async getByScholarshipId(scholarshipId: number): Promise<XanoScholarshipVehicle[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_opportunity_scholarship_vehicles?registration_opportunity_scholarship_id=${scholarshipId}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const all = await this.getAll();
          return all.filter((v) => v.registration_opportunity_scholarship_id === scholarshipId);
        }
        const results: XanoScholarshipVehicle[] = await res.json();
        return Array.isArray(results) ? results : [];
      } catch {
        const all = await this.getAll();
        return all.filter((v) => v.registration_opportunity_scholarship_id === scholarshipId);
      }
    },
  },

  busStops: {
    async getAll(): Promise<XanoBusStop[]> {
      const res = await fetch(`${getBaseUrl()}/registration_bus`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  familyPayments: {
    async getByFamilyAndYear(familyId: number, yearId: number): Promise<XanoFamilyPayment | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_families_payment?registration_families_id=${familyId}&registration_school_years_id=${yearId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const results = await res.json();
        const items = Array.isArray(results) ? results : [results];
        return items.find(
          (p: XanoFamilyPayment) =>
            p.registration_families_id === familyId &&
            p.registration_school_years_id === yearId
        ) ?? null;
      } catch {
        return null;
      }
    },

    async create(data: Omit<XanoFamilyPayment, "id" | "created_at">): Promise<XanoFamilyPayment> {
      const res = await fetch(`${getBaseUrl()}/registration_families_payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async update(id: number, data: Partial<Omit<XanoFamilyPayment, "id" | "created_at">>): Promise<XanoFamilyPayment> {
      const res = await fetch(`${getBaseUrl()}/registration_families_payment/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  emergencyContacts: {
    async create(data: Omit<XanoEmergencyContact, "id" | "created_at">): Promise<XanoEmergencyContact> {
      const res = await fetch(`${getBaseUrl()}/registration_emergency_contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getByFamilyId(familyId: number): Promise<XanoEmergencyContact[]> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_emergency_contacts?registration_families_id=${familyId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return [];
        const results = await res.json();
        return Array.isArray(results) ? results.filter((c: XanoEmergencyContact) => c.registration_families_id === familyId) : [];
      } catch {
        return [];
      }
    },

    async update(id: number, data: Partial<Omit<XanoEmergencyContact, "id" | "created_at">>): Promise<XanoEmergencyContact> {
      const res = await fetch(`${getBaseUrl()}/registration_emergency_contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_emergency_contacts/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  studentRegistration: {
    async create(data: Omit<XanoStudentRegistration, "id" | "created_at">): Promise<XanoStudentRegistration> {
      const res = await fetch(`${getBaseUrl()}/registration_student_registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async getByStudentId(studentId: number): Promise<XanoStudentRegistration | null> {
      try {
        const res = await fetch(
          `${getBaseUrl()}/registration_student_registration?registration_students_id=${studentId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const results = await res.json();
        const items = Array.isArray(results) ? results : [];
        const match = items.find((r: XanoStudentRegistration) => r.registration_students_id === studentId);
        return match ?? null;
      } catch {
        return null;
      }
    },

    async update(id: number, data: Partial<Omit<XanoStudentRegistration, "id" | "created_at">>): Promise<XanoStudentRegistration> {
      const res = await fetch(`${getBaseUrl()}/registration_student_registration/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_student_registration/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },

  admins: {
    async getByClerkId(clerkUserId: string): Promise<XanoAdmin | null> {
      try {
        const res = await fetch(`${getBaseUrl()}/registration_admin`, { cache: "no-store" });
        if (!res.ok) return null;
        const all: XanoAdmin[] = await res.json();
        return all.find((a) => a.clerk_user_id === clerkUserId) ?? null;
      } catch {
        return null;
      }
    },

    async getAll(): Promise<XanoAdmin[]> {
      const res = await fetch(`${getBaseUrl()}/registration_admin`, { cache: "no-store" });
      if (!res.ok) return [];
      return res.json();
    },
  },

  inquiries: {
    async getAll(): Promise<XanoInquiry[]> {
      const res = await fetch(`${getBaseUrl()}/registration_inquiry`, { cache: "no-store" });
      if (!res.ok) return [];
      return res.json();
    },

    async getById(id: number): Promise<XanoInquiry> {
      const res = await fetch(`${getBaseUrl()}/registration_inquiry/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
      return res.json();
    },

    async delete(id: number): Promise<void> {
      const res = await fetch(`${getBaseUrl()}/registration_inquiry/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Xano error ${res.status}: ${await res.text()}`);
    },
  },
};
