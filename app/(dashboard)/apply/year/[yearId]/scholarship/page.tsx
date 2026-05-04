"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import Image from "next/image";
import { useUser } from "@clerk/nextjs";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StateSelect } from "@/components/state-select";
import { OptionSelect } from "@/components/option-select";
import { US_STATES } from "@/lib/us-states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, FileUp, X, Loader2, CheckCircle2, Users, Home, Car, ArrowRight, ExternalLink, Plus, HelpCircle } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlobalSaveStatusPill } from "@/components/save-status-pill";
import { useFamilyProgress } from "@/hooks/use-family-progress";
import { useReapplyFamilyProgress } from "@/hooks/use-reapply-family-progress";
import { toast } from "sonner";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";

import { AnimatePresence, motion } from "framer-motion";
import SignatureCanvas from "react-signature-canvas";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
} from "@/components/ui/file-upload";

interface SchoolYear {
  id: number;
  year_name: string;
  opportunity_scholarship_deadline: string | null;
  fes_eo_8: number;
  fes_eo_9: number;
  ftc_8: number;
  ftc_9: number;
  fes_ua_8_ese_1_3: number;
  fes_ua_9_ese_1_3: number;
  fes_ua_ese_4: number;
  fes_ua_ese_5: number;
}

interface SufsStudent {
  id: number;
  first_name: string;
  last_name: string;
  photo: string | { url: string } | null;
}

interface SufsApplication {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  sufs_award_id?: number;
}

const STEP_UP_URL = "https://www.stepupforstudents.org/scholarships/logins/";

function sufsInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function getSufsPhotoUrl(photo: SufsStudent["photo"]): string | undefined {
  if (!photo) return undefined;
  if (typeof photo === "string") return photo.startsWith("http") ? photo : undefined;
  if (typeof photo === "object" && photo.url) return photo.url;
  return undefined;
}

interface Scholarship {
  id: number;
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
  family_contribution_per_month: number;
  scholarship_advocacy_letter: string;
  snap_benefits: Record<string, unknown>[];
  other_benefits: Record<string, unknown>[];
  signature: Record<string, unknown> | null;
  /** Multi-file array of unemployment / termination proof — required when
   *  `no_contributing_member` is true. Replaces the older single-file
   *  `termination_letter` column. */
  unemployment_letter: Record<string, unknown>[];
  last_edited: number | null;
  isNotParticipating: boolean;
  isSNAPBenefits: boolean;
  isOpportunityScholarship: boolean;
}

interface FullScholarshipResponse {
  opportunity_scholarship: Scholarship;
  homes: Home[];
  vehicles: Vehicle[];
  contributing_members: ContributingMember[];
  benefits: Benefit[];
}

interface ContributingMember {
  id: number;
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
  /** W-2 documents — multi-file array. A single member's W-2 packet can
   *  span multiple pages, so the schema stores an array of file metadata
   *  rather than one file slot. Legacy rows may contain a single object
   *  in place of an array; the `toFileArray` helper normalizes both. */
  w2: Record<string, unknown>[] | Record<string, unknown> | null;
  paystub_1: Record<string, unknown>[] | Record<string, unknown> | null;
  paystub_2: Record<string, unknown>[] | Record<string, unknown> | null;
  paystub_3: Record<string, unknown>[] | Record<string, unknown> | null;
  paystub_4: Record<string, unknown>[] | Record<string, unknown> | null;
}

interface Home {
  id: number;
  type: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  zipcode: string;
  total_value: number;
  outstanding_debt: number;
}

interface Vehicle {
  id: number;
  type: string;
  car_make: string;
  car_model: string;
  car_year: string;
  total_value: number;
  remaining_debt: number;
}

interface Benefit {
  id: number;
  type: string;
  amount_monthly: number;
  /** Per-benefit documentation (award letters, approval notices, etc.).
   *  Multi-file array — one benefit may need several pages of paperwork
   *  to verify. Replaces the family-wide `other_benefits` blob; each
   *  benefit row is now self-contained. */
  benefit_documentation: Record<string, unknown>[];
}

function formatCurrencyDisplay(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function LocalInput({
  value,
  onBlurSave,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "onBlur" | "onChange" | "value"> & {
  value: string;
  onBlurSave: (val: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);

  return (
    <Input
      {...props}
      value={local}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={(e) => {
        focusedRef.current = false;
        onBlurSave(e.target.value);
      }}
    />
  );
}

function CurrencyInput({
  id,
  value,
  onChange,
  onBlur,
  disabled,
  placeholder,
  className: extraClassName,
}: {
  id?: string;
  value: number;
  onChange: (val: number) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [display, setDisplay] = useState(
    value ? formatCurrencyDisplay(value) : ""
  );
  const focusedRef = useRef(false);
  const localValueRef = useRef(value);

  useEffect(() => {
    if (!focusedRef.current) {
      setDisplay(value ? formatCurrencyDisplay(value) : "");
    }
    localValueRef.current = value;
  }, [value]);

  return (
    <div className="relative">
      <span className="text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 text-sm">
        $
      </span>
      <Input
        id={id}
        className={`pl-7 ${extraClassName ?? ""}`}
        value={display}
        placeholder={placeholder ?? "0"}
        disabled={disabled}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          const num = Number(raw) || 0;
          setDisplay(raw ? formatCurrencyDisplay(num) : "");
          localValueRef.current = num;
        }}
        onBlur={() => {
          focusedRef.current = false;
          const num = localValueRef.current;
          setDisplay(num ? formatCurrencyDisplay(num) : "");
          onChange(num);
          onBlur?.();
        }}
      />
    </div>
  );
}

function isDeadlinePassed(deadline: string | null): boolean {
  if (!deadline) return false;
  return new Date() > new Date(deadline + "T23:59:59");
}

export default function ScholarshipPage() {
  const params = useParams();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { user } = useUser();
  const firstName = user?.firstName ?? "";
  const yearId = Number(params.yearId);

  const {
    setPageTitle,
    registerSaveHandler,
    unregisterSaveHandler,
    updateSaveOptions,
    registerOnBack,
    unregisterOnBack,
    setHideBottomBar,
    trackAutosave,
  } = useApplicationFlow();

  const [schoolYear, setSchoolYear] = useState<SchoolYear | null>(null);
  const [scholarship, setScholarship] = useState<Scholarship | null>(null);
  const [familyId, setFamilyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // SUFS (Step Up For Students) — per-student Award ID, stored on each yearly application
  const [sufsStudents, setSufsStudents] = useState<SufsStudent[]>([]);
  const [sufsApplications, setSufsApplications] = useState<SufsApplication[]>([]);
  const [sufsSavingAppId, setSufsSavingAppId] = useState<number | null>(null);
  const [stepUpDialogOpen, setStepUpDialogOpen] = useState(false);
  // Pending target when the user is switching between scholarship choices.
  // Drives the "Switch selection?" warning modal. Must live at the top of the
  // component — below the `if (loading) return …` early return it breaks Rules of Hooks.
  const [pendingSwitchTo, setPendingSwitchTo] = useState<"none" | "snap" | "full" | null>(null);
  const [saving, setSaving] = useState(false);
  const [scholarshipChoice, setScholarshipChoice] = useState<"none" | "snap" | "full" | null>(null);
  const [notParticipatingConfirm, setNotParticipatingConfirm] = useState(false);
  const [snapModalOpen, setSnapModalOpen] = useState(false);
  const [resetChoiceConfirm, setResetChoiceConfirm] = useState(false);

  const [members, setMembers] = useState<ContributingMember[]>([]);
  const [homes, setHomes] = useState<Home[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [benefits, setBenefits] = useState<Benefit[]>([]);

  const [householdAdults, setHouseholdAdults] = useState(0);
  const [householdChildren, setHouseholdChildren] = useState(0);
  const [noContributing, setNoContributing] = useState(false);

  const [businessIncome, setBusinessIncome] = useState(0);
  const [capitalGains, setCapitalGains] = useState(0);
  const [childSupport, setChildSupport] = useState(0);
  const [alimony, setAlimony] = useState(0);
  const [trustsIncome, setTrustsIncome] = useState(0);
  const [otherIncome, setOtherIncome] = useState(0);
  const [describeOtherIncome, setDescribeOtherIncome] = useState("");

  const [assetsChecking, setAssetsChecking] = useState(0);
  const [assetsSavings, setAssetsSavings] = useState(0);
  const [assetsRetirement, setAssetsRetirement] = useState(0);
  const [assetsStocks, setAssetsStocks] = useState(0);
  const [assetsTrusts, setAssetsTrusts] = useState(0);
  const [assetsBusiness, setAssetsBusiness] = useState(0);

  const [debtsCreditCards, setDebtsCreditCards] = useState(0);
  const [debtsStudentLoans, setDebtsStudentLoans] = useState(0);
  const [debtsPersonalLoans, setDebtsPersonalLoans] = useState(0);

  const [govBenefits, setGovBenefits] = useState(false);
  const [familyContribution, setFamilyContribution] = useState(0);
  const [advocacyLetter, setAdvocacyLetter] = useState("");
  const [signatureMeta, setSignatureMeta] = useState<Record<string, unknown> | null>(null);
  const [signatureLocalUrl, setSignatureLocalUrl] = useState<string | null>(null);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [snapBenefitsFiles, setSnapBenefitsFiles] = useState<Record<string, unknown>[]>([]);
  const [otherBenefitsFiles, setOtherBenefitsFiles] = useState<Record<string, unknown>[]>([]);
  const [unemploymentLetter, setUnemploymentLetter] = useState<Record<string, unknown>[]>([]);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const savedSnapshotRef = useRef<string>("");
  const initialSnapshotRef = useRef<string>("");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const handleSaveRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const [showForm, setShowForm] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<{
    type: "member" | "benefit" | "home" | "vehicle";
    id: number;
    label: string;
  } | null>(null);

  const [addingMember, setAddingMember] = useState(false);
  const [addingHome, setAddingHome] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [addingBenefit, setAddingBenefit] = useState(false);

  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const scholarshipInitCollapseRef = useRef(false);

  function toggleSection(key: string) {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Helpers for working with file metadata — both the single-object shape
  // (legacy rows) and the array shape (W-2, paystub_*, benefit_documentation
  // post-schema-change). A slot is "uploaded" if at least one entry has a
  // canonical Xano `path`.
  const hasFileObject = (f: unknown): boolean =>
    !!f && typeof f === "object" && !Array.isArray(f) &&
    typeof (f as { path?: unknown }).path === "string" &&
    (f as { path: string }).path.length > 0;
  /** Normalize either shape (legacy single object, new array, or null) into
   *  an array of file metadata objects. Drops empty `{}` placeholders. */
  const toFileArray = (v: unknown): Record<string, unknown>[] => {
    if (Array.isArray(v)) return v.filter(hasFileObject) as Record<string, unknown>[];
    if (hasFileObject(v)) return [v as Record<string, unknown>];
    return [];
  };
  /** True when at least one usable file is present in the slot. Works
   *  uniformly for legacy single-object slots and new array slots. */
  const hasFile = (v: unknown): boolean => toFileArray(v).length > 0;

  const incomeComplete = householdAdults > 0 && householdChildren > 0 &&
    (!govBenefits ||
      // Each benefit row needs type + amount, AND at least one
      // documentation file uploaded into its own `benefit_documentation`
      // slot. The page-level "Supporting Documentation" upload was
      // removed — every benefit is self-contained now.
      (benefits.length > 0 &&
        benefits.every(
          (b) =>
            b.type &&
            b.amount_monthly > 0 &&
            hasFile(b.benefit_documentation)
        )));

  // Per-member income verification: each contributing member must select
  // either W-2 or pay stubs AND upload at least one file in each required
  // slot. The slots are now arrays (multi-file), so a single page in a
  // multi-page packet doesn't pretend to be the whole packet.
  const memberIncomeVerified = (m: ContributingMember): boolean => {
    if (m.isW2) return hasFile(m.w2);
    if (m.isPayStubs) {
      return (
        hasFile(m.paystub_1) &&
        hasFile(m.paystub_2) &&
        hasFile(m.paystub_3) &&
        hasFile(m.paystub_4)
      );
    }
    return false;
  };

  // "No contributing members" branch is satisfied only when at least one
  // unemployment / termination letter has been uploaded — the family
  // checkbox alone isn't enough proof for admins to verify zero income.
  const membersComplete = noContributing
    ? hasFile(unemploymentLetter)
    : (
      members.length > 0 &&
      members.every(
        (m) =>
          m.first_name &&
          m.last_name &&
          m.address_1 &&
          m.city &&
          m.state &&
          m.zipcode &&
          m.estimated_annual_income > 0 &&
          memberIncomeVerified(m)
      )
    );

  const assetsComplete = (
    (homes.length === 0 || homes.every(h => h.type && h.address_1 && h.city && h.state && h.zipcode && h.total_value > 0 && h.outstanding_debt >= 0)) &&
    (vehicles.length === 0 || vehicles.every(v => v.type && v.car_make && v.car_model && v.car_year && v.total_value > 0 && v.remaining_debt >= 0))
  );

  const contributionComplete = familyContribution > 0 && advocacyLetter.trim().length > 0;

  // Default every section to OPEN on initial load. Users can manually collapse
  // via the chevron, but completion never auto-collapses anything.
  useEffect(() => {
    if (scholarshipInitCollapseRef.current || !showForm || loading) return;
    scholarshipInitCollapseRef.current = true;
    setOpenSections(new Set(["income", "members", "assets", "contribution"]));
  }, [showForm, loading]);

  const sigCanvasRef = useRef<SignatureCanvas>(null);
  const sigRestoredRef = useRef(false);

  function buildSnapshot() {
    return JSON.stringify({
      householdAdults, householdChildren, noContributing,
      businessIncome, capitalGains, childSupport, alimony, trustsIncome,
      otherIncome, describeOtherIncome, assetsChecking, assetsSavings,
      assetsRetirement, assetsStocks, assetsTrusts, assetsBusiness,
      debtsCreditCards, debtsStudentLoans, debtsPersonalLoans,
      govBenefits, familyContribution, advocacyLetter,
      signatureMeta, unemploymentLetter,
      members, homes, vehicles, benefits,
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const currentSnapshotMemo = useMemo(() => buildSnapshot(), [
    householdAdults, householdChildren, noContributing,
    businessIncome, capitalGains, childSupport, alimony, trustsIncome,
    otherIncome, describeOtherIncome, assetsChecking, assetsSavings,
    assetsRetirement, assetsStocks, assetsTrusts, assetsBusiness,
    debtsCreditCards, debtsStudentLoans, debtsPersonalLoans,
    govBenefits, familyContribution, advocacyLetter,
    signatureMeta, unemploymentLetter,
    members, homes, vehicles, benefits,
  ]);

  const isDirty = savedSnapshotRef.current !== "" && currentSnapshotMemo !== savedSnapshotRef.current;

  function captureSnapshot() {
    savedSnapshotRef.current = buildSnapshot();
  }

  const loadData = useCallback(async () => {
    try {
      const familyRes = await fetch("/api/families");
      if (!familyRes.ok) return;
      const familyData = await familyRes.json();
      if (!familyData?.id) return;
      setFamilyId(familyData.id);

      const [yearRes, scholarshipRes, studentsRes, appsRes] = await Promise.all([
        fetch("/api/school-years"),
        fetch(`/api/scholarship?familyId=${familyData.id}&yearId=${yearId}`),
        fetch("/api/students"),
        fetch("/api/applications"),
      ]);

      if (studentsRes.ok) {
        setSufsStudents(await studentsRes.json());
      }
      if (appsRes.ok) {
        const allApps: SufsApplication[] = await appsRes.json();
        setSufsApplications(allApps.filter((a) => a.registration_school_years_id === yearId));
      }

      if (yearRes.ok) {
        const years: SchoolYear[] = await yearRes.json();
        setSchoolYear(years.find((y) => y.id === yearId) ?? null);
      }

      if (scholarshipRes.ok) {
        const data: Scholarship | null = await scholarshipRes.json();
        if (data) {
          const fullRes = await fetch(`/api/scholarship/${data.id}`);
          if (fullRes.ok) {
            const resp: FullScholarshipResponse = await fullRes.json();
            const s = resp.opportunity_scholarship;
            setScholarship(s);
            populateForm(s);
            if (s.isNotParticipating) {
              setScholarshipChoice("none");
            } else if (s.isSNAPBenefits) {
              setScholarshipChoice("snap");
            } else if (s.isOpportunityScholarship) {
              setScholarshipChoice("full");
            }
            const loadedMembers = resp.contributing_members ?? [];
            const loadedHomes = resp.homes ?? [];
            const loadedVehicles = resp.vehicles ?? [];
            const loadedBenefits = resp.benefits ?? [];
            setMembers(loadedMembers);
            setHomes(loadedHomes);
            setVehicles(loadedVehicles);
            setBenefits(loadedBenefits);
            initialSnapshotRef.current = JSON.stringify({
              householdAdults: s.household_adults ?? 0,
              householdChildren: s.household_children ?? 0,
              noContributing: s.no_contributing_member ?? false,
              businessIncome: s.business_income_monthly ?? 0,
              capitalGains: s.capital_gains_monthly ?? 0,
              childSupport: s.child_support_monthly ?? 0,
              alimony: s.alimony_monthly ?? 0,
              trustsIncome: s.trusts_monthly ?? 0,
              otherIncome: s.other_income_monthly ?? 0,
              describeOtherIncome: s.describe_other_income ?? "",
              assetsChecking: s.assets_checking ?? 0,
              assetsSavings: s.assets_savings ?? 0,
              assetsRetirement: s.assets_retirement_savings ?? 0,
              assetsStocks: s.assets_stocks_bonds_securities ?? 0,
              assetsTrusts: s.assets_trusts_inheritance ?? 0,
              assetsBusiness: s.assets_business ?? 0,
              debtsCreditCards: s.debts_credit_cards ?? 0,
              debtsStudentLoans: s.debts_student_loans ?? 0,
              debtsPersonalLoans: s.debts_personal_loans ?? 0,
              govBenefits: s.government_benefits ?? false,
              familyContribution: s.family_contribution_per_month ?? 0,
              advocacyLetter: s.scholarship_advocacy_letter ?? "",
              signatureMeta: (() => {
                if (!s.signature) return null;
                let sig: Record<string, unknown>;
                if (typeof s.signature === "string") {
                  try { sig = JSON.parse(s.signature); } catch { sig = {}; }
                } else {
                  sig = s.signature as Record<string, unknown>;
                }
                return Object.keys(sig).length > 0 ? sig : null;
              })(),
              unemploymentLetter: Array.isArray(s.unemployment_letter)
                ? s.unemployment_letter
                : [],
              members: loadedMembers,
              homes: loadedHomes,
              vehicles: loadedVehicles,
              benefits: loadedBenefits,
            });
          }
        }
      }
    } catch (err) {
      console.error("Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, [yearId]);

  // Local edit handler — updates state immediately so users see their typing.
  // SUFS Award IDs are 9-digit numeric codes issued by Step Up For Students.
  function handleSufsAwardIdChange(appId: number, raw: string) {
    const digitsOnly = raw.replace(/\D/g, "").slice(0, 9);
    const num = digitsOnly === "" ? 0 : Number(digitsOnly);
    setSufsApplications((prev) =>
      prev.map((a) => (a.id === appId ? { ...a, sufs_award_id: num } : a))
    );
  }

  // Persists on blur — cheap PATCH when the user leaves the field.
  async function handleSufsAwardIdBlur(appId: number) {
    const app = sufsApplications.find((a) => a.id === appId);
    if (!app) return;
    setSufsSavingAppId(appId);
    try {
      await trackAutosave(
        fetch(`/api/applications/${appId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sufs_award_id: app.sufs_award_id ?? 0 }),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`Save failed (${res.status})`);
          return res;
        })
      );
    } catch (err) {
      console.error("Failed to save SUFS Award ID:", err);
    } finally {
      setSufsSavingAppId(null);
    }
  }

  function populateForm(s: Scholarship) {
    setHouseholdAdults(s.household_adults ?? 0);
    setHouseholdChildren(s.household_children ?? 0);
    setNoContributing(s.no_contributing_member ?? false);
    setBusinessIncome(s.business_income_monthly ?? 0);
    setCapitalGains(s.capital_gains_monthly ?? 0);
    setChildSupport(s.child_support_monthly ?? 0);
    setAlimony(s.alimony_monthly ?? 0);
    setTrustsIncome(s.trusts_monthly ?? 0);
    setOtherIncome(s.other_income_monthly ?? 0);
    setDescribeOtherIncome(s.describe_other_income ?? "");
    setAssetsChecking(s.assets_checking ?? 0);
    setAssetsSavings(s.assets_savings ?? 0);
    setAssetsRetirement(s.assets_retirement_savings ?? 0);
    setAssetsStocks(s.assets_stocks_bonds_securities ?? 0);
    setAssetsTrusts(s.assets_trusts_inheritance ?? 0);
    setAssetsBusiness(s.assets_business ?? 0);
    setDebtsCreditCards(s.debts_credit_cards ?? 0);
    setDebtsStudentLoans(s.debts_student_loans ?? 0);
    setDebtsPersonalLoans(s.debts_personal_loans ?? 0);
    setGovBenefits(s.government_benefits ?? false);
    setFamilyContribution(s.family_contribution_per_month ?? 0);
    setAdvocacyLetter(s.scholarship_advocacy_letter ?? "");
    if (s.last_edited) setLastSaved(new Date(s.last_edited));
    if (s.signature) {
      let sig: Record<string, unknown>;
      if (typeof s.signature === "string") {
        try { sig = JSON.parse(s.signature); } catch { sig = {}; }
      } else {
        sig = s.signature as Record<string, unknown>;
      }
      if (Object.keys(sig).length > 0) {
        setSignatureMeta(sig);
        if (typeof sig.url === "string") {
          setSignatureLocalUrl(sig.url);
        } else if (typeof sig.path === "string") {
          const base = process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io";
          setSignatureLocalUrl(`${base}${sig.path}`);
        }
      }
    }
    if (Array.isArray(s.snap_benefits) && s.snap_benefits.length > 0) {
      setSnapBenefitsFiles(s.snap_benefits as Record<string, unknown>[]);
    }
    if (Array.isArray(s.other_benefits) && s.other_benefits.length > 0) {
      setOtherBenefitsFiles(s.other_benefits as Record<string, unknown>[]);
    }
    if (Array.isArray(s.unemployment_letter)) {
      setUnemploymentLetter(s.unemployment_letter as Record<string, unknown>[]);
    }
  }

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!loading && initialSnapshotRef.current && savedSnapshotRef.current === "") {
      savedSnapshotRef.current = initialSnapshotRef.current;
    }
  }, [loading]);

  useEffect(() => {
    if (!lastSaved) return;
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, [lastSaved]);

  const sigDataUrlRef = useRef<string | null>(null);

  async function restoreSignatureToCanvas() {
    if (!sigCanvasRef.current || sigRestoredRef.current) return;
    const url = sigDataUrlRef.current;
    if (!url) return;

    let dataUrl = url;
    if (!url.startsWith("data:")) {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {
        return;
      }
    }

    sigCanvasRef.current.fromDataURL(dataUrl);
    sigRestoredRef.current = true;
  }

  useEffect(() => {
    sigDataUrlRef.current = signatureLocalUrl;
  }, [signatureLocalUrl]);

  useEffect(() => {
    if (!showForm) return;
    sigRestoredRef.current = false;
    const timer = setTimeout(() => restoreSignatureToCanvas(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm]);

  // When inside the scholarship form, back button returns to selection page
  useEffect(() => {
    if (showForm) {
      registerOnBack(() => setShowForm(false));
    } else {
      unregisterOnBack();
    }
    return () => unregisterOnBack();
  }, [showForm, registerOnBack, unregisterOnBack]);

  // Opening the full Opportunity Scholarship form should land the
  // parent at the top — they were probably mid-scroll on the path
  // chooser when they clicked "Apply", and starting the form mid-page
  // hides the page header + first input.
  useEffect(() => {
    if (showForm) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [showForm]);

  // Keep all sections open — no auto-collapse on completion

  async function ensureScholarship(): Promise<number | null> {
    if (scholarship) return scholarship.id;
    if (!familyId) return null;

    const res = await fetch("/api/scholarship", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registration_families_id: familyId,
        registration_school_years_id: yearId,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    setScholarship(data);
    return data.id;
  }

  async function handleSave() {
    setSaving(true);
    savingRef.current = true;
    try {
      const sid = await ensureScholarship();
      if (!sid) return;

      const scholarshipPatch = fetch(`/api/scholarship/${sid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          household_adults: householdAdults,
          household_children: householdChildren,
          no_contributing_member: noContributing,
          business_income_monthly: businessIncome,
          capital_gains_monthly: capitalGains,
          child_support_monthly: childSupport,
          alimony_monthly: alimony,
          trusts_monthly: trustsIncome,
          other_income_monthly: otherIncome,
          describe_other_income: describeOtherIncome,
          assets_checking: assetsChecking,
          assets_savings: assetsSavings,
          assets_retirement_savings: assetsRetirement,
          assets_stocks_bonds_securities: assetsStocks,
          assets_trusts_inheritance: assetsTrusts,
          assets_business: assetsBusiness,
          debts_credit_cards: debtsCreditCards,
          debts_student_loans: debtsStudentLoans,
          debts_personal_loans: debtsPersonalLoans,
          government_benefits: govBenefits,
          family_contribution_per_month: familyContribution,
          scholarship_advocacy_letter: advocacyLetter,
          snap_benefits: snapBenefitsFiles,
          other_benefits: otherBenefitsFiles,
          signature: signatureMeta,
          unemployment_letter: unemploymentLetter,
          last_edited: Date.now(),
        }),
      });

      const memberPatches = members.map((m) =>
        fetch(`/api/scholarship-items/contributing-members/${m.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: m.first_name,
            last_name: m.last_name,
            address_1: m.address_1,
            address_2: m.address_2,
            city: m.city,
            state: m.state,
            zipcode: m.zipcode,
            estimated_annual_income: m.estimated_annual_income,
            isW2: m.isW2,
            isPayStubs: m.isPayStubs,
            // Each verification slot is now a multi-file array. Normalize
            // before PATCH so legacy single-object rows get rewritten as
            // arrays the first time they save through the new UI.
            w2: toFileArray(m.w2),
            paystub_1: toFileArray(m.paystub_1),
            paystub_2: toFileArray(m.paystub_2),
            paystub_3: toFileArray(m.paystub_3),
            paystub_4: toFileArray(m.paystub_4),
          }),
        })
      );

      const homePatches = homes.map((h) =>
        fetch(`/api/scholarship-items/homes/${h.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: h.type,
            address_1: h.address_1,
            address_2: h.address_2,
            city: h.city,
            state: h.state,
            zipcode: h.zipcode,
            total_value: h.total_value,
            outstanding_debt: h.outstanding_debt,
          }),
        })
      );

      const vehiclePatches = vehicles.map((v) =>
        fetch(`/api/scholarship-items/vehicles/${v.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: v.type,
            car_make: v.car_make,
            car_model: v.car_model,
            car_year: v.car_year,
            total_value: v.total_value,
            remaining_debt: v.remaining_debt,
          }),
        })
      );

      const benefitPatches = benefits.map((b) =>
        fetch(`/api/scholarship-items/benefits/${b.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: b.type,
            amount_monthly: b.amount_monthly,
            // Persist the per-benefit documentation array. Older benefit
            // rows may have arrived without this field; default to [] so
            // we never PATCH `undefined` into the column.
            benefit_documentation: Array.isArray(b.benefit_documentation)
              ? b.benefit_documentation
              : [],
          }),
        })
      );

      const [scholarshipRes] = await trackAutosave(
        Promise.all([
          scholarshipPatch,
          ...memberPatches,
          ...homePatches,
          ...vehiclePatches,
          ...benefitPatches,
        ]).then((results) => {
          // Surface any failed PATCH so the badge goes red and errors aren't silent.
          const failed = results.find((r) => !r.ok);
          if (failed) throw new Error(`Save failed (${failed.status})`);
          return results;
        })
      );

      if (scholarshipRes.ok) {
        const saved: Scholarship = await scholarshipRes.json();
        setScholarship(saved);
        setLastSaved(saved.last_edited ? new Date(saved.last_edited) : new Date());
      } else {
        setLastSaved(new Date());
      }
      captureSnapshot();
    } catch (err) {
      console.error("Save failed:", err);
      throw err;
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  handleSaveRef.current = handleSave;

  useEffect(() => {
    setPageTitle("Financial Aid");
    return () => unregisterSaveHandler();
  }, [setPageTitle, unregisterSaveHandler]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flow-aware progress: same component renders under both /apply and
  // /reapply. On /apply we track the apply progress row's
  // `financial_aid_completed` bool; on /reapply we track the reapply
  // progress row's `isScholarship` bool. Both hooks always mount (rules of
  // hooks), but we pass `null` to the inactive one so only the active
  // flow's progress endpoint is hit per page mount.
  const pathnameForFlow = usePathname();
  const isReapplyFlow = pathnameForFlow.startsWith("/reapply");
  const applyProgress = useFamilyProgress(isReapplyFlow ? null : yearId);
  const reapplyProgress = useReapplyFamilyProgress(isReapplyFlow ? yearId : null);
  const scholarshipLocked = isReapplyFlow
    ? !!reapplyProgress.progress?.isScholarship
    : !!applyProgress.progress?.financial_aid_completed;
  // Stabilize the setter via a ref — the progress hooks return fresh
  // object literals each render, so listing them in useCallback deps
  // would cause the consumer useEffect to re-fire indefinitely.
  const flowRef = useRef({ isReapplyFlow, applyProgress, reapplyProgress });
  flowRef.current = { isReapplyFlow, applyProgress, reapplyProgress };
  const setScholarshipLocked = useCallback((value: boolean) => {
    const f = flowRef.current;
    return f.isReapplyFlow
      ? f.reapplyProgress.setSection("isScholarship", value)
      : f.applyProgress.setSection("financial_aid_completed", value);
  }, []);

  const handleCompleteScholarshipRef = useRef<() => Promise<void>>(() => Promise.resolve());
  handleCompleteScholarshipRef.current = async () => {
    if (!scholarshipChoice) {
      toast.error("Please select a financial aid option before completing this section.");
      throw new Error("Validation failed");
    }
    if (scholarshipChoice === "full" && !isScholarshipFormComplete) {
      toast.error("Please fill out all required fields in the scholarship application.");
      throw new Error("Validation failed");
    }
    if (scholarshipChoice === "snap" && snapBenefitsFiles.length === 0) {
      toast.error("Please upload your SNAP benefits award letter.");
      throw new Error("Validation failed");
    }
    await handleSaveRef.current?.();
    await setScholarshipLocked(true);
    toast.success("Financial aid section completed.");
  };

  useEffect(() => {
    registerSaveHandler(() => handleCompleteScholarshipRef.current(), {
      label: "Complete Financial Aid Section",
    });
  }, [registerSaveHandler]);

  useEffect(() => {
    if (scholarshipLocked) {
      updateSaveOptions({
        completed: true,
        completedLabel: "Financial Aid Section Completed",
        onUnlock: () => void setScholarshipLocked(false),
      });
    } else {
      const hasValidChoice = scholarshipChoice === "none" || scholarshipChoice === "snap" || scholarshipChoice === "full";
      updateSaveOptions({
        // Explicitly clear completed + onUnlock — `updateSaveOptions`
        // shallow-merges into the previous state, so without these the
        // stale `completed: true` from the locked branch sticks around
        // after unlock and the layout keeps dimming + click-blocking
        // the page even though the section is now editable again.
        completed: false,
        onUnlock: undefined,
        saving,
        disabled: !hasValidChoice || saving,
        label: "Complete Financial Aid Section",
      });
    }
  }, [saving, scholarshipChoice, scholarshipLocked, updateSaveOptions, setScholarshipLocked]);

  // Section unlock when a new student is added is now handled inline
  // by the Students page's `handleAddToYear` (it PATCHes the relevant
  // section bools to false on the same family-progress row this page
  // reads). The previous useEffect-based revoke here race'd the
  // layout's pointer-events-none wrapper.

  useEffect(() => {
    if (savedSnapshotRef.current === "" || savingRef.current) return;
    if (currentSnapshotMemo === savedSnapshotRef.current) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      if (!savingRef.current) handleSaveRef.current?.();
    }, 4000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSnapshotMemo]);

  function patchMemberLocal(id: number, data: Partial<ContributingMember>) {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...data } : m))
    );
  }
  function patchHomeLocal(id: number, data: Partial<Home>) {
    setHomes((prev) => prev.map((h) => (h.id === id ? { ...h, ...data } : h)));
  }
  function patchVehicleLocal(id: number, data: Partial<Vehicle>) {
    setVehicles((prev) =>
      prev.map((v) => (v.id === id ? { ...v, ...data } : v))
    );
  }
  function patchBenefitLocal(id: number, data: Partial<Benefit>) {
    setBenefits((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...data } : b))
    );
  }



  async function addMember() {
    setAddingMember(true);
    try {
      const sid = await ensureScholarship();
      if (!sid) return;
      const res = await fetch(`/api/scholarship/${sid}/contributing-members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) setMembers([...members, await res.json()]);
    } finally {
      setAddingMember(false);
    }
  }

  function deleteMember(id: number) {
    setMembers((prev) => prev.filter((m) => m.id !== id));
    fetch(`/api/scholarship-items/contributing-members/${id}`, {
      method: "DELETE",
    }).catch((err) => console.error("Failed to delete member:", err));
  }

  async function addHome() {
    setAddingHome(true);
    try {
      const sid = await ensureScholarship();
      if (!sid) return;
      const res = await fetch(`/api/scholarship/${sid}/homes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) setHomes([...homes, await res.json()]);
    } finally {
      setAddingHome(false);
    }
  }

  function deleteHome(id: number) {
    setHomes((prev) => prev.filter((h) => h.id !== id));
    fetch(`/api/scholarship-items/homes/${id}`, { method: "DELETE" }).catch((err) => console.error("Failed to delete home:", err));
  }

  async function addVehicle() {
    setAddingVehicle(true);
    try {
      const sid = await ensureScholarship();
      if (!sid) return;
      const res = await fetch(`/api/scholarship/${sid}/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) setVehicles([...vehicles, await res.json()]);
    } finally {
      setAddingVehicle(false);
    }
  }

  function deleteVehicle(id: number) {
    setVehicles((prev) => prev.filter((v) => v.id !== id));
    fetch(`/api/scholarship-items/vehicles/${id}`, { method: "DELETE" }).catch((err) => console.error("Failed to delete vehicle:", err));
  }

  async function addBenefit() {
    setAddingBenefit(true);
    try {
      const sid = await ensureScholarship();
      if (!sid) return;
      const res = await fetch(`/api/scholarship/${sid}/benefits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) setBenefits([...benefits, await res.json()]);
    } finally {
      setAddingBenefit(false);
    }
  }

  function deleteBenefit(id: number) {
    setBenefits((prev) => prev.filter((b) => b.id !== id));
    fetch(`/api/scholarship-items/benefits/${id}`, { method: "DELETE" }).catch((err) => console.error("Failed to delete benefit:", err));
  }

  const deadlinePassed = isDeadlinePassed(
    schoolYear?.opportunity_scholarship_deadline ?? null
  );
  // Lock the form when EITHER the deadline has passed OR the section has
  // been marked complete on the progress row. Without the lock-state half,
  // marking the section complete only greyed it out visually (via the
  // layout's opacity wrapper) — every input was still editable underneath,
  // and unlocking didn't change anything because nothing was actually
  // disabled to begin with.
  const isReadonly = deadlinePassed || scholarshipLocked;

  function confirmDelete() {
    if (!pendingDelete) return;
    switch (pendingDelete.type) {
      case "member": deleteMember(pendingDelete.id); break;
      case "benefit": deleteBenefit(pendingDelete.id); break;
      case "home": deleteHome(pendingDelete.id); break;
      case "vehicle": deleteVehicle(pendingDelete.id); break;
    }
    setPendingDelete(null);
  }

  async function handleSignatureEnd() {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return;
    const dataUrl = sigCanvasRef.current.toDataURL("image/png");
    setSignatureLocalUrl(dataUrl);
    setSignatureUploading(true);
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], "signature.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        const meta = await res.json();
        setSignatureMeta(meta);
      }
    } catch (err) {
      console.error("Signature upload failed:", err);
    } finally {
      setSignatureUploading(false);
    }
  }

  function clearSignature() {
    sigCanvasRef.current?.clear();
    setSignatureMeta(null);
    setSignatureLocalUrl(null);
    sigRestoredRef.current = false;
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div>
          <div className="flex items-center justify-between gap-3 pb-3 border-b">
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-8 w-3/4 mt-4" />
          <Skeleton className="h-4 w-2/3 mt-3" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6">
            <Skeleton className="h-5 w-48 mb-5" />
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j}>
                  <Skeleton className="h-3 w-24 mb-2" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const isChoiceLocked = scholarshipChoice === "none" || scholarshipChoice === "snap" || scholarshipChoice === "full";
  const isScholarshipFormComplete = incomeComplete && membersComplete && assetsComplete && contributionComplete && !!signatureMeta;

  // Per-student SUFS block. Rendered on both the chooser screen (!showForm)
  // and the full Opportunity Scholarship form (showForm) so it's always visible.
  const sufsBlock = (() => {
    const enrolled = sufsApplications
      .map((app) => ({
        app,
        student: sufsStudents.find((s) => s.id === app.registration_students_id),
      }))
      .filter((x): x is { app: SufsApplication; student: SufsStudent } => !!x.student);

    if (enrolled.length === 0) {
      return (
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="py-3 !pb-3">
            <CardTitle className="text-lg">Step Up For Students</CardTitle>
          </CardHeader>
          <CardContent className="py-5 bg-white dark:bg-background">
            <p className="text-sm text-muted-foreground">
              No students enrolled for this year. Add students first in the Student Enrollment step.
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        {/* Shared SUFS info + Apply button — appears once above the student cards */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Image
              src="/logos/step-up.png"
              alt="Step Up for Students"
              width={36}
              height={36}
              className="size-9 rounded-full border-4 border-gray-200"
            />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Step Up for Students Scholarship
            </p>
          </div>
          <h2 className="text-2xl font-semibold">
            Step 1: Apply for Florida Tax Voucher SUFS Scholarship (Up to $8,000)
          </h2>
          <p className="text-sm text-muted-foreground mt-3 mb-4 max-w-2xl">
            Available to all Florida students eligible for K-12 public school, regardless of household income.{" "}
            <span className="font-semibold text-foreground">$8,000</span> average scholarship for private school tuition and related fees. If your student has been awarded a Step Up scholarship, enter their Award ID below.
          </p>
          <Button
            type="button"
            className="w-full"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setStepUpDialogOpen(true);
            }}
          >
            <ExternalLink className="size-4 mr-1.5 shrink-0" />
            <span className="truncate">Apply for the Step Up for Students Scholarship</span>
          </Button>
        </div>

        {/* Per-student cards — just the Award ID input, full width */}
        {enrolled.map(({ app, student }) => {
          const photoUrl = getSufsPhotoUrl(student.photo);
          return (
            <Card key={student.id} className="overflow-hidden gap-0 py-0">
              {/* Students-page card format — avatar + name + status icon only.
                  No trash icon, no chevron, not collapsible. */}
              <CardHeader className="py-3 !pb-3 border-b">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-10">
                      {photoUrl ? <AvatarImage src={photoUrl} alt={`${student.first_name} ${student.last_name}`} /> : null}
                      <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                        {sufsInitials(student.first_name, student.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    <CardTitle className="text-lg">
                      {student.first_name} {student.last_name}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    {app.sufs_award_id && app.sufs_award_id > 0 ? (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
                        <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                        </svg>
                      </div>
                    ) : (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                        <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                          <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3 py-5 bg-white dark:bg-background">
                <Field>
                  <FieldLabel className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      SUFS Award ID <span className="text-red-400">*</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="inline-flex text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                            <HelpCircle className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs mb-2">Your SUFS Award ID is a 9-digit numerical code assigned by Step Up For Students. Find it in your Step Up for Students parent portal under your student&apos;s scholarship details.</p>
                          <div className="rounded border overflow-hidden">
                            <Image
                              src="/1.webp"
                              alt="Example showing where to find your SUFS Award ID"
                              width={300}
                              height={200}
                              className="w-full h-auto"
                            />
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </FieldLabel>
                  <Input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={9}
                    placeholder="000000000"
                    className={`w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${!app.sufs_award_id ? "border-2 border-red-400" : ""}`}
                    value={app.sufs_award_id || ""}
                    disabled={sufsSavingAppId === app.id}
                    onChange={(e) => handleSufsAwardIdChange(app.id, e.target.value)}
                    onBlur={() => handleSufsAwardIdBlur(app.id)}
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Enter the 9-digit Award ID from your Step Up For Students parent
                    portal (under your student&apos;s scholarship details).
                  </p>
                </Field>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  })();

  async function saveScholarshipChoice(choice: "none" | "snap" | "full") {
    const sid = await ensureScholarship();
    if (!sid) return;
    await trackAutosave(
      fetch(`/api/scholarship/${sid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isNotParticipating: choice === "none",
          isSNAPBenefits: choice === "snap",
          isOpportunityScholarship: choice === "full",
          last_edited: Date.now(),
        }),
      }).then(async (res) => {
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        return res;
      })
    );
    // Revalidate SWR caches so side nav + overview table update immediately
    mutate(`/api/scholarship/${sid}`);
    if (familyId) mutate(`/api/scholarship?familyId=${familyId}&yearId=${yearId}`);
  }

  async function resetScholarshipChoice() {
    setScholarshipChoice(null);
    setShowForm(false);
    if (scholarship?.id) {
      await fetch(`/api/scholarship/${scholarship.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isNotParticipating: false,
          isSNAPBenefits: false,
          isOpportunityScholarship: false,
          last_edited: Date.now(),
        }),
      });
      // Revalidate SWR caches
      mutate(`/api/scholarship/${scholarship.id}`);
      if (familyId) mutate(`/api/scholarship?familyId=${familyId}&yearId=${yearId}`);
    }
  }

  // Click on a chooser row. If no choice yet, proceeds to the row's flow;
  // if a *different* choice is active, opens a switch-confirmation modal.
  function handleChooserRowClick(target: "none" | "snap" | "full") {
    if (scholarshipChoice && scholarshipChoice !== target) {
      setPendingSwitchTo(target);
      return;
    }
    // No switch needed — run the row's flow directly.
    if (target === "none") {
      setNotParticipatingConfirm(true);
    } else if (target === "snap") {
      setSnapModalOpen(true);
    } else if (target === "full") {
      // Re-clicking "full" when already on it: just re-enter the form.
      if (scholarshipChoice !== "full") {
        setScholarshipChoice("full");
        void saveScholarshipChoice("full");
      }
      setShowForm(true);
    }
  }

  // Confirm the switch — clear current state, then run the target's flow.
  async function confirmSwitchSelection() {
    const target = pendingSwitchTo;
    setPendingSwitchTo(null);
    if (!target) return;
    await resetScholarshipChoice();
    // After reset, run the target's flow.
    if (target === "none") {
      setNotParticipatingConfirm(true);
    } else if (target === "snap") {
      setSnapModalOpen(true);
    } else if (target === "full") {
      setScholarshipChoice("full");
      await saveScholarshipChoice("full");
      setShowForm(true);
    }
  }

  if (!showForm) {
    return (
      <div className="flex flex-col px-4 pt-8 pb-4 mx-auto w-full max-w-4xl gap-6">
          {/* Page header — introduces the two funding paths (Step 1 + Step 2) */}
          <div className="pb-4 border-b">
            <div className="flex items-center justify-between gap-3 pb-3 border-b">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Financial Aid
              </p>
              <GlobalSaveStatusPill />
            </div>
            <h1 className="text-2xl font-semibold mt-4">
              Complete both scholarship steps to maximize your tuition assistance.
            </h1>
            <p className="text-muted-foreground text-sm mt-2 max-w-2xl">
              Most families qualify for state-funded scholarships and may be
              eligible for additional support from SailFuture. Complete both
              steps below to maximize your tuition assistance.
            </p>
          </div>

          {/* SUFS — rendered at the top even before the Opportunity Scholarship chooser */}
          {sufsBlock}

          {/* Horizontal divider between SUFS and Opportunity Scholarship */}
          <Separator />

          <div className="w-full">
          <div className="text-left mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Image
                src="/logo.svg"
                alt="SailFuture Academy"
                width={36}
                height={36}
                className="size-9 rounded-full border-4 border-gray-200"
              />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                SailFuture Opportunity Scholarship
              </p>
            </div>
            <h1 className="text-2xl font-semibold">
              Step 2: Apply for Additional SailFuture Support (Up to $20,000)
            </h1>
            <p className="text-muted-foreground text-sm mt-3 w-full">
              The SailFuture Academy Scholarship is designed to support students who exhibit financial need, academic promise, and a strong commitment to their education. This scholarship is awarded on a sliding scale, with the amount determined by the applicant&apos;s household income and assets.
            </p>
            <div className="mt-6">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Nationally Recognized and Scholarships Funded By:
              </p>
              <div className="flex items-center justify-start gap-4">
                <Image src="/logos/yass-prize.png" alt="The Yass Prize" width={36} height={36} className="size-9 rounded-full" />
                <Image src="/logos/google.png" alt="Google" width={36} height={36} className="size-9" />
                <Image src="/logos/linkedin.png" alt="LinkedIn" width={36} height={36} className="size-9 rounded-full" />
                <Image src="/logos/stand-together.png" alt="Stand Together" width={36} height={36} className="size-9 rounded-full" />
                <Image src="/logos/att.png" alt="AT&T" width={36} height={36} className="size-9 rounded-full" />
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-background p-1.5 shadow-sm border">
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {/* Choose not to participate */}
                  <tr
                    className={`transition-colors cursor-pointer ${
                      scholarshipChoice === "none"
                        ? "bg-gray-50 dark:bg-muted/30 hover:bg-gray-100 dark:hover:bg-muted/50"
                        : "hover:bg-muted/30"
                    }`}
                    onClick={() => handleChooserRowClick("none")}
                  >
                    <td className="px-4 py-4 w-12">
                      <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                        scholarshipChoice === "none"
                          ? "bg-green-500 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {scholarshipChoice === "none" ? (
                          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <span className="text-xs font-semibold">1</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-4">
                      <p className="font-medium">Choose not to participate</p>
                    </td>
                    <td className="px-4 py-4 w-10 text-muted-foreground">
                      <div className="flex size-7 items-center justify-center rounded-md border border-border">
                        <ArrowRight className="size-3.5" />
                      </div>
                    </td>
                  </tr>

                  {/* SNAP benefits */}
                  <tr
                    className={`transition-colors cursor-pointer ${
                      scholarshipChoice === "snap"
                        ? "bg-gray-50 dark:bg-muted/30 hover:bg-gray-100 dark:hover:bg-muted/50"
                        : "hover:bg-muted/30"
                    }`}
                    onClick={() => handleChooserRowClick("snap")}
                  >
                    <td className="px-4 py-4 w-12">
                      <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                        scholarshipChoice === "snap" && snapBenefitsFiles.length > 0
                          ? "bg-green-500 text-white"
                          : scholarshipChoice === "snap"
                            ? "bg-amber-500 text-white"
                            : "bg-muted text-muted-foreground"
                      }`}>
                        {scholarshipChoice === "snap" && snapBenefitsFiles.length > 0 ? (
                          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                          </svg>
                        ) : scholarshipChoice === "snap" ? (
                          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                            <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                          </svg>
                        ) : (
                          <span className="text-xs font-semibold">2</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-4">
                      <p className="font-medium">I receive SNAP benefits</p>
                    </td>
                    <td className="px-4 py-4 w-10 text-muted-foreground">
                      <div className="flex size-7 items-center justify-center rounded-md border border-border">
                        <ArrowRight className="size-3.5" />
                      </div>
                    </td>
                  </tr>

                  {/* Continue scholarship */}
                  <tr
                    className={`transition-colors cursor-pointer ${
                      scholarshipChoice === "full"
                        ? "bg-gray-50 dark:bg-muted/30 hover:bg-gray-100 dark:hover:bg-muted/50"
                        : "hover:bg-muted/30"
                    }`}
                    onClick={() => handleChooserRowClick("full")}
                  >
                    <td className="px-4 py-4 w-12">
                      <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                        scholarshipChoice === "full" && isScholarshipFormComplete
                          ? "bg-green-500 text-white"
                          : scholarshipChoice === "full"
                            ? "bg-amber-500 text-white"
                            : "bg-muted text-muted-foreground"
                      }`}>
                        {scholarshipChoice === "full" && isScholarshipFormComplete ? (
                          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                          </svg>
                        ) : scholarshipChoice === "full" ? (
                          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                            <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                          </svg>
                        ) : (
                          <span className="text-xs font-semibold">3</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-4">
                      <p className="font-medium">
                        {scholarship ? "Continue the SailFuture Opportunity Scholarship" : "Complete the SailFuture Opportunity Scholarship"}
                      </p>
                    </td>
                    <td className="px-4 py-4 w-10 text-muted-foreground">
                      <div className="flex size-7 items-center justify-center rounded-md border border-border">
                        <ArrowRight className="size-3.5" />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>


        </div>

        {/* Switch Selection Warning Modal — fires when clicking a row that
            differs from the current choice. */}
        <AlertDialog
          open={!!pendingSwitchTo}
          onOpenChange={(open) => { if (!open) setPendingSwitchTo(null); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Switch your selection?</AlertDialogTitle>
              <AlertDialogDescription>
                You&apos;ve already picked a different path. Switching will clear your
                current selection and any data entered on that path. You can change back
                later by clicking another row.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Current Selection</AlertDialogCancel>
              <AlertDialogAction onClick={confirmSwitchSelection}>
                Yes, Switch
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Not Participating Warning Modal */}
        <AlertDialog open={notParticipatingConfirm} onOpenChange={setNotParticipatingConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Choose Not to Participate?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you do not wish to apply for the SailFuture Opportunity Scholarship? This selection can be changed later by contacting the school.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  setScholarshipChoice("none");
                  setNotParticipatingConfirm(false);
                  await saveScholarshipChoice("none");
                }}
              >
                Yes, I Do Not Wish to Participate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* SNAP Benefits Modal */}
        <AlertDialog open={snapModalOpen} onOpenChange={setSnapModalOpen}>
          <AlertDialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <AlertDialogHeader>
              <AlertDialogTitle>SNAP Benefits Pre-Qualification</AlertDialogTitle>
              <AlertDialogDescription>
                If you receive SNAP benefits, you pre-qualify for the SailFuture Academy Scholarship. Upload your Florida SNAP benefits award letter below.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div>
                <IncomeFileUpload
                  label="Drop SNAP award letter here or click to upload"
                  multiple
                  existingFiles={snapBenefitsFiles as XanoFileMetadata[]}
                  onFilesChanged={async (files) => {
                    setSnapBenefitsFiles(files);
                    const sid = scholarship?.id ?? await ensureScholarship();
                    if (sid) {
                      await fetch(`/api/scholarship/${sid}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ snap_benefits: files, last_edited: Date.now() }),
                      });
                      mutate(`/api/scholarship/${sid}`);
                      if (familyId) mutate(`/api/scholarship?familyId=${familyId}&yearId=${yearId}`);
                    }
                  }}
                />
              </div>

              {/* What is a SNAP Award Letter */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <h4 className="text-sm font-semibold">What is a SNAP Award Letter?</h4>
                <p className="text-sm text-muted-foreground">
                  The SNAP (Supplemental Nutrition Assistance Program) award letter is a &quot;Notice of Case Action&quot; issued by the Florida Department of Children and Families (DCF). It confirms your household&apos;s eligibility for Food Assistance benefits and lists each eligible household member along with your benefit amount.
                </p>
                <p className="text-sm text-muted-foreground">
                  You can access your award letter by logging into your{" "}
                  <a
                    href="https://www.myflorida.com/accessflorida/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2 hover:text-primary/80"
                  >
                    MyACCESS Florida account
                  </a>
                  , or by contacting your local DCF office. If you received a physical copy in the mail, you can scan or photograph it for upload.
                </p>
                <div className="rounded-md border overflow-hidden bg-white">
                  <Image
                    src="/1.webp"
                    alt="Example Florida SNAP Benefits Award Letter - Notice of Case Action"
                    width={600}
                    height={776}
                    className="w-full h-auto"
                  />
                  <p className="text-xs text-muted-foreground text-center py-2 bg-muted/20">
                    Example: Florida DCF &quot;Notice of Case Action&quot; letter
                  </p>
                </div>
              </div>
            </div>

            <AlertDialogFooter className="shrink-0">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  setScholarshipChoice("snap");
                  setSnapModalOpen(false);
                  await saveScholarshipChoice("snap");
                }}
              >
                I Receive SNAP Benefits
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reset Selection Warning Modal */}
        <AlertDialog open={resetChoiceConfirm} onOpenChange={setResetChoiceConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change Scholarship Selection?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to change your scholarship selection? Your current choice will be cleared and you will need to select a new option. Any previously uploaded documents will remain saved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Current Selection</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  setResetChoiceConfirm(false);
                  await resetScholarshipChoice();
                }}
              >
                Yes, Change Selection
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Step Up For Students Dialog — also available on the chooser screen */}
        <Dialog open={stepUpDialogOpen} onOpenChange={setStepUpDialogOpen}>
          <DialogContent className="sm:max-w-[95vw] w-[95vw] h-[90vh] p-0 flex flex-col overflow-hidden">
            <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
              <DialogTitle>Step Up for Students</DialogTitle>
              <DialogDescription>
                Log in or create an account to manage your Step Up for Students scholarship.
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 m-6 mt-0 overflow-hidden rounded-lg border">
              <iframe
                src={STEP_UP_URL}
                className="h-full w-full border-0"
                title="Step Up for Students"
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div>
          <div className="flex items-center justify-between gap-3 pb-3 border-b">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Financial Aid
            </p>
            <GlobalSaveStatusPill />
          </div>
          <h1 className="text-2xl font-semibold mt-4">
            SailFuture Academy Opportunity Scholarship Application
          </h1>
          <p className="text-muted-foreground text-sm mt-2 max-w-2xl">
            Complete your household income, assets, and family contribution for{" "}
            {schoolYear?.year_name ?? "this year"}.
          </p>
          {/* Back button — returns to the Financial Aid chooser so users can
              switch to "not participating" or SNAP without losing their path.
              Styled to match the Back button in the inline bottom nav. */}
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-input px-3 py-2.5 text-sm font-medium transition-colors bg-white text-muted-foreground hover:text-foreground hover:bg-gray-50"
          >
            <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
            </svg>
            Back to Financial Aid options
          </button>
        </div>

        {/* SUFS deliberately omitted on the OS form view — it lives only on the
            Financial Aid chooser. Users can return via the "Back to Financial
            Aid options" link above to edit SUFS Award IDs. */}

        {deadlinePassed && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-900/20">
            <p className="text-sm text-red-700 dark:text-red-300">
              The scholarship deadline has passed. This form is view-only.
            </p>
          </div>
        )}

        {/* Annual Household Income Documentation */}
        <Card className="overflow-hidden gap-0 py-0 ring-0 border">
          <CardHeader className="border-b py-3 !pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="text-lg">Household Information</CardTitle>
                <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                  Enter who lives in your home and any income your household
                  receives to continue.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {incomeComplete ? (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white"><svg className="size-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg></div>
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white"><svg className="size-4" viewBox="0 0 20 20" fill="currentColor"><path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" /><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" /></svg></div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
            <section>
              <h3 className="text-lg font-medium">
                Who Lives in Your Home
              </h3>
              <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-2xl">
                Add all adults and children living in your home.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel className="text-xs">
                    Number of Adults <span className="text-red-400">*</span>
                  </FieldLabel>
                  <Input
                    type="number"
                    min={0}
                    value={householdAdults || ""}
                    onChange={(e) =>
                      setHouseholdAdults(Number(e.target.value) || 0)
                    }
                    disabled={isReadonly}
                    className={!householdAdults ? "border-2 border-red-400" : ""}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Number of Children <span className="text-red-400">*</span>
                  </FieldLabel>
                  <Input
                    type="number"
                    min={0}
                    value={householdChildren || ""}
                    onChange={(e) =>
                      setHouseholdChildren(Number(e.target.value) || 0)
                    }
                    disabled={isReadonly}
                    className={!householdChildren ? "border-2 border-red-400" : ""}
                  />
                </Field>
              </div>
            </section>

            {/* Government Benefits */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Government Assistance
              </h3>
              <div className="inline-flex w-auto items-center gap-3">
                {/* Only the checkbox is clickable — the label text is inert so
                    clicking the phrase doesn't toggle the state by accident. */}
                <input
                  type="checkbox"
                  id="gov_benefits"
                  checked={govBenefits}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setGovBenefits(checked);
                    // Unchecking removes any previously-added benefits so they
                    // aren't retained as hidden data.
                    if (!checked && benefits.length > 0) {
                      const toDelete = [...benefits];
                      setBenefits([]);
                      toDelete.forEach((b) => {
                        fetch(`/api/scholarship-items/benefits/${b.id}`, { method: "DELETE" })
                          .catch((err) => console.error("Failed to delete benefit:", err));
                      });
                    }
                  }}
                  disabled={isReadonly}
                  className="size-5 cursor-pointer rounded accent-primary"
                />
                <span className="text-sm select-none">My household receives government assistance (SNAP, SSI, etc.)</span>
              </div>
              <AnimatePresence initial={false}>
              {govBenefits && (
                <motion.div
                  key="gov-benefits-section"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-3 border-b pb-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Benefit Types
                    </h4>
                    {!isReadonly && (
                      <Button size="sm" onClick={addBenefit}>
                        Add Benefit
                      </Button>
                    )}
                  </div>
                  {benefits.length === 0 && !addingBenefit ? (
                    <p className="text-muted-foreground text-sm">
                      No benefits listed.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <AnimatePresence initial={false}>
                      {benefits.map((benefit) => (
                        <motion.div
                          key={benefit.id}
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
                          transition={{ duration: 0.18 }}
                          // Vertical layout per benefit so the per-row
                          // documentation upload sits cleanly underneath the
                          // type/amount inputs.
                          className="rounded-lg border bg-card p-4 space-y-3"
                        >
                          <div className="flex items-end gap-3">
                          <Field className="flex-1">
                            <FieldLabel className="text-xs">Type <span className="text-red-400">*</span></FieldLabel>
                            <Select
                              value={benefit.type}
                              onValueChange={(val) => {
                                patchBenefitLocal(benefit.id, { type: val });
                              }}
                              disabled={isReadonly}
                            >
                              <SelectTrigger className={`w-full ${!benefit.type ? "border-2 border-red-400" : ""}`}>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                {/* SNAP is intentionally NOT listed here —
                                    SNAP recipients pre-qualify for the full
                                    SailFuture Academy Scholarship via the
                                    dedicated SNAP path on the financial-aid
                                    chooser, so we don't want them duplicating
                                    it as a generic government benefit. */}
                                <SelectItem value="Medicaid">Medicaid</SelectItem>
                                <SelectItem value="TANF">TANF</SelectItem>
                                <SelectItem value="WIC">WIC</SelectItem>
                                <SelectItem value="SSI">SSI</SelectItem>
                                <SelectItem value="SSDI">SSDI</SelectItem>
                                <SelectItem value="Housing Assistance">
                                  Housing Assistance
                                </SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field className="flex-1">
                            <FieldLabel className="text-xs">
                              Monthly Amount <span className="text-red-400">*</span>
                            </FieldLabel>
                            <CurrencyInput
                              value={benefit.amount_monthly}
                              onChange={(val) => patchBenefitLocal(benefit.id, { amount_monthly: val })}
                              disabled={isReadonly}
                              className={!benefit.amount_monthly ? "border-2 border-red-400" : ""}
                            />
                          </Field>
                          {!isReadonly && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-red-600"
                            onClick={() => setPendingDelete({ type: "benefit", id: benefit.id, label: "this benefit" })}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                          </div>

                          {/* Per-benefit documentation. Each row is now
                              self-contained — type + amount + the matching
                              award letter / approval notice — so admins
                              can verify each benefit individually instead
                              of digging through one combined supporting-
                              documents pile. */}
                          <div>
                            <p className="text-xs font-medium mb-2">
                              Documentation for this benefit{" "}
                              <span className="text-red-400">*</span>
                            </p>
                            <IncomeFileUpload
                              label="Drop award letter / approval notice here or click to upload"
                              multiple
                              disabled={isReadonly}
                              error={!hasFile(benefit.benefit_documentation)}
                              existingFiles={
                                toFileArray(
                                  benefit.benefit_documentation
                                ) as XanoFileMetadata[]
                              }
                              onFilesChanged={(files) =>
                                patchBenefitLocal(benefit.id, {
                                  benefit_documentation: files,
                                })
                              }
                            />
                          </div>
                        </motion.div>
                      ))}
                      </AnimatePresence>
                      {addingBenefit && (
                        <div className="rounded-lg border bg-card p-4 animate-pulse space-y-3">
                          <div className="flex items-end gap-3">
                            <div className="flex-1 space-y-1.5">
                              <Skeleton className="h-3 w-10" />
                              <Skeleton className="h-9 w-full rounded-md" />
                            </div>
                            <div className="flex-1 space-y-1.5">
                              <Skeleton className="h-3 w-20" />
                              <Skeleton className="h-9 w-full rounded-md" />
                            </div>
                            <Skeleton className="size-8 rounded-md" />
                          </div>
                          <Skeleton className="h-16 w-full rounded-md" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                </motion.div>
              )}
              </AnimatePresence>
            </section>
          </CardContent>
        </Card>

        {/* Contributing Members */}
        <Card className="overflow-hidden gap-0 py-0 ring-0 border">
            <CardHeader className="border-b py-3 !pb-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="text-lg">Household Members with Income</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                    Identify each person in your household who provides or is responsible for any portion of the family&apos;s income.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {membersComplete ? (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white"><svg className="size-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg></div>
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white"><svg className="size-4" viewBox="0 0 20 20" fill="currentColor"><path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" /><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" /></svg></div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
              {/* "No contributing members" option — moved here from the Income
                  card. Checking it hides the members list and surfaces a
                  termination-letter upload instead. */}
              <div className="inline-flex items-center gap-3">
                <input
                  type="checkbox"
                  id="no_contributing"
                  checked={noContributing}
                  onChange={(e) => setNoContributing(e.target.checked)}
                  disabled={isReadonly}
                  className="size-5 cursor-pointer rounded accent-primary"
                />
                <span className="text-sm select-none">
                  No contributing members in the household
                </span>
              </div>

              <AnimatePresence initial={false} mode="wait">
              {noContributing ? (
                <motion.div
                  key="no-contributing-branch"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <p className="text-sm text-muted-foreground mb-3">
                    You have selected that you have no persons who are currently
                    employed or have a contributing income to the household. If
                    this is accurate, please upload proof of unemployment or
                    termination — at least one document is required.
                  </p>
                  <p className="text-xs font-medium mb-2">
                    Termination / Unemployment Letter{" "}
                    <span className="text-red-400">*</span>
                  </p>
                  <IncomeFileUpload
                    label="Drop letters here or click to upload"
                    multiple
                    disabled={isReadonly}
                    error={!hasFile(unemploymentLetter)}
                    existingFiles={unemploymentLetter as XanoFileMetadata[]}
                    onFilesChanged={(files) => setUnemploymentLetter(files)}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="members-branch"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
              {members.length === 0 && !addingMember ? (
                <Empty className="border rounded-lg py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Users />
                    </EmptyMedia>
                    <EmptyTitle>No Contributing Members</EmptyTitle>
                    <EmptyDescription>Add members of your household who contribute income.</EmptyDescription>
                  </EmptyHeader>
                  {!isReadonly && (
                    <EmptyContent>
                      <Button size="sm" onClick={addMember} disabled={addingMember}>Add Member</Button>
                    </EmptyContent>
                  )}
                </Empty>
              ) : (
                <div className="space-y-4">
                  <AnimatePresence initial={false}>
                  {members.map((member, idx) => (
                    <motion.div
                      key={member.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      className="rounded-xl bg-card p-4 shadow-xs border"
                    >
                      <div className="-mx-4 mb-3 flex items-center justify-between border-b px-4 pb-3">
                        <p className="text-sm font-semibold">
                          Income Earner {idx + 1}
                        </p>
                        {!isReadonly && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-red-600"
                              onClick={() => setPendingDelete({ type: "member", id: member.id, label: `Income Earner ${idx + 1}` })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel className="text-xs">First Name <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={member.first_name ?? ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { first_name: val })}
                            disabled={isReadonly}
                            className={!(member.first_name ?? "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Last Name <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={member.last_name ?? ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { last_name: val })}
                            disabled={isReadonly}
                            className={!(member.last_name ?? "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                      </div>

                      <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr]">
                        <Field>
                          <FieldLabel className="text-xs">Street Address <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={member.address_1 || ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { address_1: val })}
                            disabled={isReadonly}
                            placeholder="123 Main Street"
                            className={!(member.address_1 || "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Apt, Suite, etc.</FieldLabel>
                          <LocalInput
                            value={member.address_2 || ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { address_2: val })}
                            disabled={isReadonly}
                            placeholder="Apt 4B"
                          />
                        </Field>
                      </div>
                      <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
                        <Field>
                          <FieldLabel className="text-xs">City <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={member.city || ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { city: val })}
                            disabled={isReadonly}
                            placeholder="St. Petersburg"
                            className={!(member.city || "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">State <span className="text-red-400">*</span></FieldLabel>
                          <StateSelect
                            value={member.state || ""}
                            invalid={!(member.state || "").trim()}
                            disabled={isReadonly}
                            onChange={(v) => patchMemberLocal(member.id, { state: v })}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Zip Code <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={member.zipcode || ""}
                            onBlurSave={(val) => patchMemberLocal(member.id, { zipcode: val })}
                            disabled={isReadonly}
                            placeholder="33701"
                            className={!(member.zipcode || "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                      </div>

                      <Separator className="my-4" />

                      <div className="space-y-4">
                        <Field className="max-w-xs">
                          <FieldLabel className="text-xs">Estimated Annual Income <span className="text-red-400">*</span></FieldLabel>
                          <CurrencyInput
                            value={member.estimated_annual_income || 0}
                            onChange={(val) => patchMemberLocal(member.id, { estimated_annual_income: val })}
                            disabled={isReadonly}
                            className={!(member.estimated_annual_income || 0) ? "border-2 border-red-400" : ""}
                          />
                        </Field>

                        <div>
                          <FieldLabel className="text-xs mb-2">
                            Income Verification{" "}
                            <span className="text-red-400">*</span>
                          </FieldLabel>
                          {!memberIncomeVerified(member) && (
                            <p className="text-xs text-red-500 mb-2">
                              Required — upload a W-2 or all four most-recent pay stubs.
                            </p>
                          )}
                          <div className="flex items-center gap-5">
                            <label htmlFor={`w2-${member.id}`} className="inline-flex w-auto cursor-pointer items-center gap-2.5">
                              <input
                                type="checkbox"
                                id={`w2-${member.id}`}
                                checked={!!member.isW2}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    patchMemberLocal(member.id, { isW2: true, isPayStubs: false });
                                  } else {
                                    patchMemberLocal(member.id, { isW2: false });
                                  }
                                }}
                                disabled={isReadonly}
                                className="size-5 cursor-pointer rounded accent-primary"
                              />
                              <span className="text-sm select-none">W-2 Form</span>
                            </label>
                            <label htmlFor={`paystubs-${member.id}`} className="inline-flex w-auto cursor-pointer items-center gap-2.5">
                              <input
                                type="checkbox"
                                id={`paystubs-${member.id}`}
                                checked={!!member.isPayStubs}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    patchMemberLocal(member.id, { isPayStubs: true, isW2: false });
                                  } else {
                                    patchMemberLocal(member.id, { isPayStubs: false });
                                  }
                                }}
                                disabled={isReadonly}
                                className="size-5 cursor-pointer rounded accent-primary"
                              />
                              <span className="text-sm select-none">Last 4 Pay Stubs</span>
                            </label>
                          </div>
                          <AnimatePresence initial={false} mode="wait">
                          {member.isW2 && (
                            <motion.div
                              key={`w2-upload-${member.id}`}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2, ease: "easeInOut" }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3">
                                <p className="text-xs font-medium mb-2">
                                  Upload W-2 Form{" "}
                                  <span className="text-red-400">*</span>
                                </p>
                                <IncomeFileUpload
                                  label="Drop W-2 pages here or click to upload"
                                  multiple
                                  disabled={isReadonly}
                                  error={!hasFile(member.w2)}
                                  existingFiles={
                                    toFileArray(member.w2) as XanoFileMetadata[]
                                  }
                                  onFilesChanged={(files) =>
                                    patchMemberLocal(member.id, { w2: files })
                                  }
                                />
                              </div>
                            </motion.div>
                          )}
                          {member.isPayStubs && (
                            <motion.div
                              key={`paystubs-upload-${member.id}`}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2, ease: "easeInOut" }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 space-y-3">
                                {([1, 2, 3, 4] as const).map((num) => {
                                  const field = `paystub_${num}` as keyof ContributingMember;
                                  const stub = member[field];
                                  return (
                                    <div key={num}>
                                      <p className="text-xs font-medium mb-2">
                                        Pay Stub {num}{" "}
                                        <span className="text-red-400">*</span>
                                      </p>
                                      <IncomeFileUpload
                                        label={`Drop pay stub ${num} pages here or click to upload`}
                                        multiple
                                        disabled={isReadonly}
                                        error={!hasFile(stub)}
                                        existingFiles={
                                          toFileArray(stub) as XanoFileMetadata[]
                                        }
                                        onFilesChanged={(files) =>
                                          patchMemberLocal(member.id, {
                                            [field]: files,
                                          })
                                        }
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </motion.div>
                          )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                  {addingMember && (
                    <div className="rounded-xl bg-card p-4 shadow-xs border animate-pulse">
                      <div className="-mx-4 mb-3 flex items-center justify-between border-b px-4 pb-3">
                        <Skeleton className="h-4 w-40" />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5"><Skeleton className="h-3 w-16" /><Skeleton className="h-9 w-full rounded-md" /></div>
                        <div className="space-y-1.5"><Skeleton className="h-3 w-16" /><Skeleton className="h-9 w-full rounded-md" /></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
                </motion.div>
              )}
              </AnimatePresence>
            </CardContent>
            {!isReadonly && (
              <div className="border-t px-4 py-3">
                <Button
                  className="w-full"
                  onClick={addMember}
                  disabled={addingMember}
                >
                  {addingMember ? <><Loader2 className="size-4 animate-spin mr-1.5" />Adding...</> : <><Plus className="size-4 mr-1.5" />Add Another Member</>}
                </Button>
              </div>
            )}
        </Card>

        {/* Other Household Income — passive / non-wage income that
            doesn't come from any single contributing member. Lives in
            its own card below Contributing Members so the form flow is
            "list the people, then list the other income streams". */}
        <Card className="overflow-hidden gap-0 py-0 ring-0 border">
          <CardHeader className="border-b py-3 !pb-3">
            <div className="min-w-0">
              <CardTitle className="text-lg">
                Other Money Your Household Receives Each Month
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                Not from a job (for example: child support or side income).
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
            <section>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field>
                  <FieldLabel className="text-xs">
                    Money from a Business or Side Job
                  </FieldLabel>
                  <CurrencyInput
                    value={businessIncome}
                    onChange={setBusinessIncome}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Money from Investments (if any)
                  </FieldLabel>
                  <CurrencyInput
                    value={capitalGains}
                    onChange={setCapitalGains}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Child Support</FieldLabel>
                  <CurrencyInput
                    value={childSupport}
                    onChange={setChildSupport}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Alimony / Spousal Support
                  </FieldLabel>
                  <CurrencyInput
                    value={alimony}
                    onChange={setAlimony}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Money from Trusts or Inheritance
                  </FieldLabel>
                  <CurrencyInput
                    value={trustsIncome}
                    onChange={setTrustsIncome}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Other Income</FieldLabel>
                  <CurrencyInput
                    value={otherIncome}
                    onChange={setOtherIncome}
                    disabled={isReadonly}
                  />
                </Field>
              </div>
              {otherIncome > 0 && (
                <div className="mt-4">
                  <Field>
                    <FieldLabel className="text-xs">
                      Describe Other Income
                    </FieldLabel>
                    <Input
                      value={describeOtherIncome}
                      onChange={(e) => setDescribeOtherIncome(e.target.value)}
                      disabled={isReadonly}
                      placeholder="Describe the source of other income"
                    />
                  </Field>
                </div>
              )}
            </section>
          </CardContent>
        </Card>

        {/* Family Household Assets */}
        <Card className="overflow-hidden gap-0 py-0 ring-0 border">
          <CardHeader className="border-b py-3 !pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="text-lg">Savings, Property &amp; Other Assets</CardTitle>
                <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                  Briefly outline all financial resources available to your household, including checking/savings accounts, investments, retirement accounts, and real estate holdings.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {assetsComplete ? (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white"><svg className="size-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg></div>
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white"><svg className="size-4" viewBox="0 0 20 20" fill="currentColor"><path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" /><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" /></svg></div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
            {/* Assets */}
            <section>
              <h3 className="text-lg font-medium">
                Your Savings and Money
              </h3>
              <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-2xl">
                Add any savings or money your family has in accounts or
                investments.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field>
                  <FieldLabel className="text-xs">
                    Money in Checking Accounts
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsChecking}
                    onChange={setAssetsChecking}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Money in Savings Accounts
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsSavings}
                    onChange={setAssetsSavings}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Retirement Accounts (401k, IRA)
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsRetirement}
                    onChange={setAssetsRetirement}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Investments (Stocks or Bonds)
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsStocks}
                    onChange={setAssetsStocks}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Trust Funds or Inheritance
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsTrusts}
                    onChange={setAssetsTrusts}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">
                    Money in a Business You Own
                  </FieldLabel>
                  <CurrencyInput
                    value={assetsBusiness}
                    onChange={setAssetsBusiness}
                    disabled={isReadonly}
                  />
                </Field>
              </div>
            </section>

            <Separator />

            {/* Debts */}
            <section>
              <h3 className="text-lg font-medium">
                Loans and Bills You&rsquo;re Paying
              </h3>
              <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-2xl">
                Add any credit cards, loans, or bills you are currently paying.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel className="text-xs">Credit Cards (total owed)</FieldLabel>
                  <CurrencyInput
                    value={debtsCreditCards}
                    onChange={setDebtsCreditCards}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Student Loans (total owed)</FieldLabel>
                  <CurrencyInput
                    value={debtsStudentLoans}
                    onChange={setDebtsStudentLoans}
                    disabled={isReadonly}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Other Loans (total owed)</FieldLabel>
                  <CurrencyInput
                    value={debtsPersonalLoans}
                    onChange={setDebtsPersonalLoans}
                    disabled={isReadonly}
                  />
                </Field>
              </div>
            </section>

            <Separator />

            {/* Homes / Real Estate */}
            <section>
              <h3 className="text-lg font-medium">
                Your Home and Property
              </h3>
              <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-2xl">
                Add any homes, land, or property your family owns.
              </p>
              {homes.length === 0 && !addingHome ? (
                <Empty className="border rounded-lg py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Home />
                    </EmptyMedia>
                    <EmptyTitle>No Properties Listed</EmptyTitle>
                    <EmptyDescription>Add any real estate or properties owned by your household.</EmptyDescription>
                  </EmptyHeader>
                  {!isReadonly && (
                    <EmptyContent>
                      <Button size="sm" onClick={addHome} disabled={addingHome}>Add Property</Button>
                    </EmptyContent>
                  )}
                </Empty>
              ) : (
                <div className="space-y-4">
                  <AnimatePresence initial={false}>
                  {homes.map((home, idx) => (
                    <motion.div
                      key={home.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      className="rounded-xl bg-card p-4 shadow-xs border"
                    >
                      <div className="-mx-4 mb-3 flex items-center justify-between border-b px-4 pb-3">
                        <p className="text-sm font-semibold">
                          Property {idx + 1}
                        </p>
                        {!isReadonly && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-red-600"
                              onClick={() => setPendingDelete({ type: "home", id: home.id, label: `Property ${idx + 1}` })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel className="text-xs">Type <span className="text-red-400">*</span></FieldLabel>
                          <OptionSelect
                            value={home.type ?? ""}
                            invalid={!(home.type ?? "").trim()}
                            disabled={isReadonly}
                            placeholder="Select type"
                            onChange={(val) => patchHomeLocal(home.id, { type: val })}
                            options={[
                              { value: "Primary Residence", label: "Primary Residence" },
                              { value: "Rental Property", label: "Rental Property" },
                              { value: "Vacation Home", label: "Vacation Home" },
                              { value: "Land", label: "Land" },
                              { value: "Other", label: "Other" },
                            ]}
                          />
                        </Field>
                      </div>
                      <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr]">
                        <Field>
                          <FieldLabel className="text-xs">Street Address <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={home.address_1 || ""}
                            onBlurSave={(val) => patchHomeLocal(home.id, { address_1: val })}
                            disabled={isReadonly}
                            placeholder="123 Main Street"
                            className={!(home.address_1 || "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Apt, Suite, etc.</FieldLabel>
                          <LocalInput
                            value={home.address_2 || ""}
                            onBlurSave={(val) => patchHomeLocal(home.id, { address_2: val })}
                            disabled={isReadonly}
                            placeholder="Apt 4B"
                          />
                        </Field>
                      </div>
                      <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
                        <Field>
                          <FieldLabel className="text-xs">City <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={home.city || ""}
                            onBlurSave={(val) => patchHomeLocal(home.id, { city: val })}
                            disabled={isReadonly}
                            placeholder="St. Petersburg"
                            className={!(home.city || "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">State <span className="text-red-400">*</span></FieldLabel>
                          <StateSelect
                            value={home.state || ""}
                            invalid={!(home.state || "").trim()}
                            disabled={isReadonly}
                            onChange={(v) => patchHomeLocal(home.id, { state: v })}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">ZIP Code <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={home.zipcode || ""}
                            onBlurSave={(val) => patchHomeLocal(home.id, { zipcode: val })}
                            disabled={isReadonly}
                            className={!(home.zipcode || "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel className="text-xs">
                            Total Value <span className="text-red-400">*</span>
                          </FieldLabel>
                          <CurrencyInput
                            value={home.total_value ?? 0}
                            onChange={(val) => patchHomeLocal(home.id, { total_value: val })}
                            disabled={isReadonly}
                            className={!(home.total_value ?? 0) ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                        <Field>
                          {/* `whitespace-nowrap` + `truncate` keeps the
                              label on one line at narrow widths; the
                              "(Enter $0 if none)" hint elides if it
                              doesn't fit so "Amount You Still Owe"
                              never wraps to a second line. */}
                          <FieldLabel className="text-xs flex items-center gap-1 min-w-0 whitespace-nowrap">
                            <span className="shrink-0">Amount You Still Owe</span>
                            <span className="text-muted-foreground font-normal truncate">
                              (Enter $0 if none)
                            </span>
                          </FieldLabel>
                          <CurrencyInput
                            value={home.outstanding_debt ?? 0}
                            onChange={(val) => patchHomeLocal(home.id, { outstanding_debt: val })}
                            disabled={isReadonly}
                          />
                        </Field>
                      </div>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                  {addingHome && (
                    <div className="rounded-xl bg-card p-4 shadow-xs border animate-pulse">
                      <div className="-mx-4 mb-3 flex items-center justify-between border-b px-4 pb-3">
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5"><Skeleton className="h-3 w-12" /><Skeleton className="h-9 w-full rounded-md" /></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!isReadonly && homes.length > 0 && (
                <Button
                  className="w-full mt-3"
                  onClick={addHome}
                  disabled={addingHome}
                >
                  {addingHome ? <><Loader2 className="size-4 animate-spin mr-1.5" />Adding...</> : <><Plus className="size-4 mr-1.5" />Add Another Property</>}
                </Button>
              )}
            </section>

            <Separator />

            {/* Vehicles */}
            <section>
              <h3 className="text-lg font-medium">
                Cars and Vehicles You Own
              </h3>
              <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-2xl">
                Add any cars, trucks, or other vehicles your family owns or
                makes payments on.
              </p>
              {vehicles.length === 0 && !addingVehicle ? (
                <Empty className="border rounded-lg py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Car />
                    </EmptyMedia>
                    <EmptyTitle>No Vehicles Listed</EmptyTitle>
                    <EmptyDescription>Add any vehicles owned by your household.</EmptyDescription>
                  </EmptyHeader>
                  {!isReadonly && (
                    <EmptyContent>
                      <Button size="sm" onClick={addVehicle} disabled={addingVehicle}>Add Vehicle</Button>
                    </EmptyContent>
                  )}
                </Empty>
              ) : (
                <div className="space-y-4">
                  <AnimatePresence initial={false}>
                  {vehicles.map((vehicle, idx) => (
                    <motion.div
                      key={vehicle.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      className="rounded-xl bg-card p-4 shadow-xs border"
                    >
                      <div className="-mx-4 mb-3 flex items-center justify-between border-b px-4 pb-3">
                        <p className="text-sm font-semibold">
                          Vehicle {idx + 1}
                        </p>
                        {!isReadonly && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-red-600"
                              onClick={() => setPendingDelete({ type: "vehicle", id: vehicle.id, label: `Vehicle ${idx + 1}` })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Field>
                          <FieldLabel className="text-xs">Type <span className="text-red-400">*</span></FieldLabel>
                          <Select
                            value={vehicle.type ?? ""}
                            onValueChange={(val) => {
                              patchVehicleLocal(vehicle.id, { type: val });
                            }}
                            disabled={isReadonly}
                          >
                            <SelectTrigger className={`w-full ${!(vehicle.type ?? "").trim() ? "border-2 border-red-400" : ""}`}>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Car">Car</SelectItem>
                              <SelectItem value="Truck">Truck</SelectItem>
                              <SelectItem value="SUV">SUV</SelectItem>
                              <SelectItem value="Van">Van</SelectItem>
                              <SelectItem value="Motorcycle">
                                Motorcycle
                              </SelectItem>
                              <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Year <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={vehicle.car_year ?? ""}
                            onBlurSave={(val) => patchVehicleLocal(vehicle.id, { car_year: val })}
                            disabled={isReadonly}
                            placeholder="e.g. 2020"
                            className={!(vehicle.car_year ?? "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Make <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={vehicle.car_make ?? ""}
                            onBlurSave={(val) => patchVehicleLocal(vehicle.id, { car_make: val })}
                            disabled={isReadonly}
                            placeholder="e.g. Toyota"
                            className={!(vehicle.car_make ?? "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">Model <span className="text-red-400">*</span></FieldLabel>
                          <LocalInput
                            value={vehicle.car_model ?? ""}
                            onBlurSave={(val) => patchVehicleLocal(vehicle.id, { car_model: val })}
                            disabled={isReadonly}
                            placeholder="e.g. Camry"
                            className={!(vehicle.car_model ?? "").trim() ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            Total Value <span className="text-red-400">*</span>
                          </FieldLabel>
                          <CurrencyInput
                            value={vehicle.total_value ?? 0}
                            onChange={(val) => patchVehicleLocal(vehicle.id, { total_value: val })}
                            disabled={isReadonly}
                            className={!(vehicle.total_value ?? 0) ? "border-2 border-red-400" : ""}
                          />
                        </Field>
                        <Field>
                          {/* `whitespace-nowrap` + `truncate` keeps the
                              label on one line at narrow widths; the
                              "(Enter $0 if none)" hint elides if it
                              doesn't fit so "Amount You Still Owe"
                              never wraps to a second line. */}
                          <FieldLabel className="text-xs flex items-center gap-1 min-w-0 whitespace-nowrap">
                            <span className="shrink-0">Amount You Still Owe</span>
                            <span className="text-muted-foreground font-normal truncate">
                              (Enter $0 if none)
                            </span>
                          </FieldLabel>
                          <CurrencyInput
                            value={vehicle.remaining_debt ?? 0}
                            onChange={(val) => patchVehicleLocal(vehicle.id, { remaining_debt: val })}
                            disabled={isReadonly}
                          />
                        </Field>
                      </div>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                  {addingVehicle && (
                    <div className="rounded-xl bg-card p-4 shadow-xs border animate-pulse">
                      <div className="-mx-4 mb-3 flex items-center justify-between border-b px-4 pb-3">
                        <Skeleton className="h-4 w-20" />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="space-y-1.5"><Skeleton className="h-3 w-12" /><Skeleton className="h-9 w-full rounded-md" /></div>
                        <div className="space-y-1.5"><Skeleton className="h-3 w-10" /><Skeleton className="h-9 w-full rounded-md" /></div>
                        <div className="space-y-1.5"><Skeleton className="h-3 w-12" /><Skeleton className="h-9 w-full rounded-md" /></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!isReadonly && vehicles.length > 0 && (
                <Button
                  className="w-full mt-3"
                  onClick={addVehicle}
                  disabled={addingVehicle}
                >
                  {addingVehicle ? <><Loader2 className="size-4 animate-spin mr-1.5" />Adding...</> : <><Plus className="size-4 mr-1.5" />Add Another Vehicle</>}
                </Button>
              )}
            </section>
          </CardContent>
        </Card>

        {/* Financial Summary — auto-calculated from the income,
            assets, and debts the family entered above. Lives right
            before the Tuition Contribution card so the admin / family
            can see the full financial picture before deciding what to
            contribute. Read-only on purpose: every number is derived,
            so editing one of them would mean editing somewhere else
            in the form. Skeleton state while the initial scholarship
            row is in-flight so we don't flash zeros. */}
        <FinancialSummaryCard
          loading={loading}
          members={members}
          businessIncome={businessIncome}
          capitalGains={capitalGains}
          childSupport={childSupport}
          alimony={alimony}
          trustsIncome={trustsIncome}
          otherIncome={otherIncome}
          assetsChecking={assetsChecking}
          assetsSavings={assetsSavings}
          assetsRetirement={assetsRetirement}
          assetsStocks={assetsStocks}
          assetsTrusts={assetsTrusts}
          assetsBusiness={assetsBusiness}
          debtsCreditCards={debtsCreditCards}
          debtsStudentLoans={debtsStudentLoans}
          debtsPersonalLoans={debtsPersonalLoans}
        />

        {/* Family Contribution & Advocacy */}
        <Card className="overflow-hidden gap-0 py-0 ring-0 border">
          <CardHeader className="border-b py-3 !pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="text-lg">Your Tuition Contribution</CardTitle>
                <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                  Tell us how much your family can reasonably contribute toward
                  tuition each month.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {contributionComplete ? (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white"><svg className="size-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg></div>
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white"><svg className="size-4" viewBox="0 0 20 20" fill="currentColor"><path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" /><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" /></svg></div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
            <section>
              <h3 className="text-lg font-medium">
                How much can your family contribute towards tuition each month?
              </h3>
              <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-2xl">
                Enter the amount your family can reasonably pay toward tuition
                each month.
              </p>
              <Field className="max-w-xs">
                <CurrencyInput
                  value={familyContribution}
                  onChange={setFamilyContribution}
                  disabled={isReadonly}
                  className={!familyContribution ? "border-2 border-red-400" : ""}
                />
              </Field>
            </section>

            <Separator />

            <section>
              <h3 className="text-lg font-medium">
                Tell Us About Your Family&rsquo;s Financial Situation
              </h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                Share your household income, typical expenses, and anything else
                we should know (such as medical costs, job changes, or
                caregiving responsibilities).
              </p>
              <p className="text-sm text-muted-foreground mt-2 mb-6 max-w-2xl">
                Let us know how much support you&rsquo;re requesting and why
                it&rsquo;s important for your child.
              </p>
              <textarea
                className={`flex min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${!advocacyLetter.trim() ? "border-2 border-red-400" : "border-input"}`}
                value={advocacyLetter}
                onChange={(e) => setAdvocacyLetter(e.target.value)}
                disabled={isReadonly}
                placeholder="Tell us about your situation and how we can support your family..."
              />
            </section>

            <Separator />

            {/* Certification & Signature */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Certification &amp; Signature
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Please take a moment to review the application details to confirm everything is correct. If there are any updates or adjustments needed, feel free to make them now or let us know so we can assist.
              </p>
              <p className="text-sm text-muted-foreground mb-3">
                Once you&apos;ve confirmed the application, please sign below and we&apos;ll proceed with the final review of your tuition amount. Should you have any questions or concerns, please don&apos;t hesitate to reach out at{" "}
                <a href="mailto:tward@sailfuture.org" className="text-primary underline">tward@sailfuture.org</a>
                {" "}or{" "}
                <a href="tel:+17279001436" className="text-primary underline">(727) 900-1436</a>
              </p>
              <p className="text-sm font-medium mb-4">
                I hereby certify that all the information provided in this application is accurate and complete to the best of my knowledge. I understand that any falsification or omission of information may result in disqualification from the scholarship program.
              </p>
              <div className="rounded-md border border-input bg-background">
                <SignatureCanvas
                  ref={sigCanvasRef}
                  penColor="black"
                  onEnd={handleSignatureEnd}
                  canvasProps={{
                    className: "w-full rounded-md cursor-crosshair",
                    style: { height: 150 },
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {signatureUploading ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3 animate-spin" /> Saving signature…
                    </span>
                  ) : signatureMeta ? (
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="size-3 text-green-600" /> Signature saved
                    </span>
                  ) : (
                    "Sign above using your mouse or touchscreen"
                  )}
                </p>
                {!isReadonly && (
                  <Button variant="outline" size="sm" onClick={clearSignature}>
                    Clear Signature
                  </Button>
                )}
              </div>
            </section>
          </CardContent>
        </Card>

      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {pendingDelete?.label}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 text-white hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Step Up For Students Dialog — rendered on the OS form view so the
          SUFS block's Apply / Visit buttons can open the iframe from here too. */}
      <Dialog open={stepUpDialogOpen} onOpenChange={setStepUpDialogOpen}>
        <DialogContent className="sm:max-w-[95vw] w-[95vw] h-[90vh] p-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Step Up for Students</DialogTitle>
            <DialogDescription>
              Log in or create an account to manage your Step Up for Students scholarship.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 m-6 mt-0 overflow-hidden rounded-lg border">
            <iframe
              src={STEP_UP_URL}
              className="h-full w-full border-0"
              title="Step Up for Students"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface XanoFileMetadata {
  path: string;
  name: string;
  type: string;
  size: number;
  mime: string;
  meta?: Record<string, unknown>;
  url?: string;
  [key: string]: unknown;
}

function IncomeFileUpload({
  label,
  disabled,
  existingFile,
  onUploaded,
  onRemoved,
  multiple,
  existingFiles,
  onFilesChanged,
  error,
}: {
  label: string;
  disabled?: boolean;
  /** Single-file mode */
  existingFile?: XanoFileMetadata | null;
  onUploaded?: (metadata: XanoFileMetadata) => void;
  onRemoved?: () => void;
  /** Multi-file mode */
  multiple?: boolean;
  existingFiles?: XanoFileMetadata[];
  onFilesChanged?: (files: XanoFileMetadata[]) => void;
  /** When true, the upload's dropzone border renders red instead of the
   *  default dashed gray — used to indicate the file is required and
   *  missing. Replaces the older wrapper-ring approach which left a
   *  visibly offset outline around the dashed border. */
  error?: boolean;
}) {
  // Multi-file mode
  if (multiple) {
    return (
      <MultiFileUpload
        label={label}
        disabled={disabled}
        existingFiles={existingFiles ?? []}
        onFilesChanged={onFilesChanged ?? (() => {})}
        error={error}
      />
    );
  }

  // Single-file mode (original behavior)
  return (
    <SingleFileUpload
      label={label}
      disabled={disabled}
      existingFile={existingFile}
      onUploaded={onUploaded}
      onRemoved={onRemoved}
      error={error}
    />
  );
}

function SingleFileUpload({
  label,
  disabled,
  existingFile,
  onUploaded,
  onRemoved,
  error: errorProp,
}: {
  label: string;
  disabled?: boolean;
  existingFile?: XanoFileMetadata | null;
  onUploaded?: (metadata: XanoFileMetadata) => void;
  onRemoved?: () => void;
  /** Renders the dropzone border red to indicate the file is required
   *  and missing. Distinct from the internal `error` state which holds
   *  upload failure messages. */
  error?: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const hasFile = existingFile && Object.keys(existingFile).length > 0 && existingFile.path;
  const [uploaded, setUploaded] = useState<XanoFileMetadata | null>(hasFile ? existingFile : null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function handleFilesChange(newFiles: File[]) {
    setFiles(newFiles);
    setError(null);

    if (newFiles.length === 0) {
      if (uploaded) {
        setConfirmRemove(true);
      }
      return;
    }

    const file = newFiles[0];
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }
      const metadata: XanoFileMetadata = await res.json();
      setUploaded(metadata);
      onUploaded?.(metadata);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setFiles([]);
    } finally {
      setUploading(false);
    }
  }

  function doRemove() {
    setUploaded(null);
    setFiles([]);
    setConfirmRemove(false);
    onRemoved?.();
  }

  if (uploaded && files.length === 0) {
    return (
      <>
        <div className="flex items-center gap-3 rounded-md border border-input bg-background px-4 py-3">
          <CheckCircle2 className="size-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{uploaded.name || "Uploaded file"}</p>
            <p className="text-xs text-muted-foreground">Uploaded successfully</p>
          </div>
          {uploaded.path && (
            <a
              href={
                uploaded.url ??
                `${process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io"}${uploaded.path}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center size-7 shrink-0 rounded-md hover:bg-muted transition-colors"
            >
              <ExternalLink className="size-4 text-muted-foreground" />
            </a>
          )}
          {!disabled && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => setConfirmRemove(true)}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove uploaded file?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the uploaded file. You can upload a new one afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={doRemove}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  // While the upload is in flight we replace the dropzone entirely with
  // an obvious uploading-state card. This is more responsive than relying
  // on the dropzone's internal "Uploading..." swap because (a) it removes
  // `FileUploadItemPreview`, which synchronously generates a thumbnail
  // for the picked file and stalls the UI on multi-MB PDFs — that was
  // the source of the "I don't see anything happen and there's a big
  // delay" report — and (b) it shows the file name + size next to the
  // spinner so the user can confirm the right file is in flight.
  if (uploading) {
    const pending = files[0];
    return (
      <div className="flex items-center gap-3 rounded-md border border-input bg-muted/40 px-4 py-3">
        <Loader2 className="size-5 text-muted-foreground shrink-0 animate-spin" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            Uploading{pending ? `: ${pending.name}` : "…"}
          </p>
          <p className="text-xs text-muted-foreground">
            {pending ? `${formatFileSize(pending.size)} · ` : ""}Hang tight — this can take a few seconds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <FileUpload
        maxFiles={1}
        maxSize={10 * 1024 * 1024}
        accept=".pdf,.jpg,.jpeg,.png"
        className="w-full"
        value={files}
        onValueChange={handleFilesChange}
        disabled={disabled}
      >
        <FileUploadDropzone
          className={`flex-row gap-3 px-4 py-3 cursor-pointer ${
            errorProp ? "border-2 border-red-400 border-solid" : ""
          }`}
        >
          <FileUp className="size-5 text-muted-foreground" />
          <div className="flex-1 text-left">
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">PDF, JPG, or PNG (max 10MB)</p>
          </div>
        </FileUploadDropzone>
      </FileUpload>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

/** Compact byte-count formatter used by the upload's in-flight card. */
function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MultiFileUpload({
  label,
  disabled,
  existingFiles,
  onFilesChanged,
  error: errorProp,
}: {
  label: string;
  disabled?: boolean;
  existingFiles: XanoFileMetadata[];
  onFilesChanged: (files: XanoFileMetadata[]) => void;
  error?: boolean;
}) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);

  // Process every selected file (not just `newFiles[0]` like the old impl).
  // Uploads sequentially so the server isn't hit with a parallel burst,
  // and so the existingFiles list grows in the order the user picked.
  async function handleNewFiles(newFiles: File[]) {
    setPendingFiles(newFiles);
    setError(null);
    if (newFiles.length === 0) return;

    setUploading(true);
    setUploadingIndex(0);
    let merged = [...existingFiles];
    try {
      for (let i = 0; i < newFiles.length; i++) {
        setUploadingIndex(i);
        const file = newFiles[i];
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Upload failed (${res.status})`);
        }
        const metadata: XanoFileMetadata = await res.json();
        merged = [...merged, metadata];
        // Push each file as it completes so the user sees progress in
        // the list, instead of all-or-nothing at the end.
        onFilesChanged(merged);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPendingFiles([]);
      setUploading(false);
      setUploadingIndex(0);
    }
  }

  function doRemove(index: number) {
    const updated = existingFiles.filter((_, i) => i !== index);
    onFilesChanged(updated);
    setRemoveIndex(null);
  }

  return (
    <>
      {/* Layout order: dropzone fixed at top, then the in-flight indicator
          (when uploading), then the list of completed uploads underneath.
          Keeps the click-target in a stable position so it doesn't move
          around as files come and go. */}
      <div className="space-y-2">
        {/* Upload dropzone — always at the top so the click target stays
            put as files accumulate below. */}
        <FileUpload
          // Allow up to 10 files in a single drop / browse so the user can
          // pick all their supporting docs at once. Previously this was
          // capped at 1, which silently dropped extras and looked broken.
          maxFiles={10}
          maxSize={10 * 1024 * 1024}
          accept=".pdf,.jpg,.jpeg,.png"
          className="w-full"
          multiple
          value={pendingFiles}
          onValueChange={handleNewFiles}
          disabled={disabled || uploading}
        >
          <FileUploadDropzone
            className={`flex-row gap-3 px-4 py-3 cursor-pointer ${
              errorProp ? "border-2 border-red-400 border-solid" : ""
            }`}
          >
            <FileUp className="size-5 text-muted-foreground" />
            <div className="flex-1 text-left">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">
                PDF, JPG, or PNG (max 10MB) · pick multiple at once
              </p>
            </div>
          </FileUploadDropzone>
        </FileUpload>

        {/* In-flight indicator. Neutral white/gray styling — earlier blue
            tinting was too loud for what is just a transient progress
            state. Sits directly under the dropzone so it doesn't push
            the dropzone around as files queue up. */}
        {uploading && (
          <div className="flex items-center gap-3 rounded-md border border-input bg-muted/40 px-4 py-3">
            <Loader2 className="size-5 text-muted-foreground shrink-0 animate-spin" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                Uploading {uploadingIndex + 1} of {pendingFiles.length}
                {pendingFiles[uploadingIndex]
                  ? `: ${pendingFiles[uploadingIndex].name}`
                  : "…"}
              </p>
              <p className="text-xs text-muted-foreground">
                Each file appears in the list below as it completes.
              </p>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

        {/* Completed uploads list — directly under the dropzone so the
            most recent uploads are nearest the user's eye after dropping
            files. */}
        {existingFiles.map((file, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-md border border-input bg-background px-4 py-3"
          >
            <CheckCircle2 className="size-5 text-green-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {file.name || "Uploaded file"}
              </p>
              <p className="text-xs text-muted-foreground">Uploaded successfully</p>
            </div>
            {file.path && (
              <a
                href={
                  file.url ??
                  `${process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io"}${file.path}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center size-7 shrink-0 rounded-md hover:bg-muted transition-colors"
              >
                <ExternalLink className="size-4 text-muted-foreground" />
              </a>
            )}
            {!disabled && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => setRemoveIndex(index)}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <AlertDialog open={removeIndex !== null} onOpenChange={(open) => { if (!open) setRemoveIndex(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove uploaded file?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the uploaded file. You can upload a new one afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => removeIndex !== null && doRemove(removeIndex)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─────────────────────── Financial Summary Card ─────────────────────── */

/**
 * Live financial overview for the Opportunity Scholarship form.
 * Sits right before "Your Tuition Contribution" so the family can
 * sanity-check the full picture (annual income, total assets,
 * personal debt, annual net) before deciding what they can pay each
 * month.
 *
 * Rendered as a 2-column table (label / value) rather than a row of
 * card tiles — denser and easier to scan when there are several
 * summary lines. Every number is derived from form state above, so
 * the table is read-only by design — editing a row would mean
 * editing the source field anyway.
 *
 * "Annual Net" combines flow + stock per the project's chosen
 * formula: annual income + total assets − total debts. (Yes, mixing
 * yearly and lump-sum figures; documented here so the math isn't
 * surprising.)
 */
function FinancialSummaryCard({
  loading,
  members,
  businessIncome,
  capitalGains,
  childSupport,
  alimony,
  trustsIncome,
  otherIncome,
  assetsChecking,
  assetsSavings,
  assetsRetirement,
  assetsStocks,
  assetsTrusts,
  assetsBusiness,
  debtsCreditCards,
  debtsStudentLoans,
  debtsPersonalLoans,
}: {
  /** When true, renders a skeleton instead of the table. Hooked up
   *  to the page-level scholarship-load flag so we don't flash a
   *  table full of $0s before the saved row hydrates. */
  loading?: boolean;
  members: Array<{ estimated_annual_income?: number }>;
  businessIncome: number;
  capitalGains: number;
  childSupport: number;
  alimony: number;
  trustsIncome: number;
  otherIncome: number;
  assetsChecking: number;
  assetsSavings: number;
  assetsRetirement: number;
  assetsStocks: number;
  assetsTrusts: number;
  assetsBusiness: number;
  debtsCreditCards: number;
  debtsStudentLoans: number;
  debtsPersonalLoans: number;
}) {
  // Wages: each contributing member's stated annual income.
  // Passive: monthly fields × 12 to land on the same yearly axis.
  const wagesAnnual = members.reduce(
    (acc, m) => acc + (m.estimated_annual_income ?? 0),
    0
  );
  const passiveAnnual =
    (businessIncome +
      capitalGains +
      childSupport +
      alimony +
      trustsIncome +
      otherIncome) *
    12;
  const totalAnnualIncome = wagesAnnual + passiveAnnual;

  const totalAssets =
    assetsChecking +
    assetsSavings +
    assetsRetirement +
    assetsStocks +
    assetsTrusts +
    assetsBusiness;

  const totalDebts =
    debtsCreditCards + debtsStudentLoans + debtsPersonalLoans;

  // Project-defined formula: income + assets − debts. Mixes flow
  // (annual income) with stock (assets / debts), which is unusual
  // but matches the spec the OS form is built against.
  const familyNet = totalAnnualIncome + totalAssets - totalDebts;

  // Each row carries its own color tone:
  //   - "positive" — income / assets / a non-negative net are good
  //                  outcomes for the family, render green when the
  //                  value is non-zero
  //   - "negative" — personal debt is a liability, always render red
  //                  when nonzero (so "$0 debt" stays foreground)
  //   - "auto"     — Family Net flips green/red on sign
  type Tone = "positive" | "negative" | "auto";
  const rows: Array<{
    label: string;
    note?: string;
    value: number;
    tone: Tone;
    isFinal?: boolean;
  }> = [
    {
      label: "Annual income",
      note: `${formatSummaryCurrency(wagesAnnual)} wages + ${formatSummaryCurrency(passiveAnnual)} passive`,
      value: totalAnnualIncome,
      tone: "positive",
    },
    {
      label: "Total assets",
      note: "Checking, savings, retirement, securities, trusts, business",
      value: totalAssets,
      tone: "positive",
    },
    {
      label: "Personal debt / liabilities",
      note: "Credit cards, student loans, personal loans",
      value: -totalDebts, // displayed as a subtraction in the table
      tone: "negative",
    },
    {
      label: "Family Net",
      note: "Annual income + total assets − personal debt",
      value: familyNet,
      tone: "auto",
      isFinal: true,
    },
  ];

  return (
    <Card className="overflow-hidden gap-0 py-0 ring-0 border">
      <CardHeader className="border-b py-3 !pb-3">
        <div className="min-w-0">
          <CardTitle className="text-lg">Financial Summary</CardTitle>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Auto-calculated from the income, assets, and debts entered
            above. Edit any line by adjusting the source field — this
            table updates live.
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0 bg-white dark:bg-background">
        {loading ? (
          // Skeletons share `px-6` so they line up under the card
          // header text — see comment on the live table below for why
          // we chose 6 instead of the 4 the rest of the admin tables
          // use.
          <div className="px-6 py-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-4"
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : (
          // `px-6` on every cell so the leftmost column lines up with
          // the card-header copy above (which uses the default
          // shadcn CardHeader padding of `px-6`). With `px-4` the
          // table sat ~8px to the left of the header, breaking the
          // visual column.
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-6 py-2">
                  Metric
                </th>
                <th className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground px-6 py-2 w-[140px]">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                // Each row picks its own tone:
                //   positive → green when nonzero (income, assets)
                //   negative → red when nonzero (personal debt)
                //   auto     → green ≥ 0, red < 0 (Family Net)
                let toneClass = "";
                if (r.tone === "positive" && r.value !== 0) {
                  toneClass = "text-green-600";
                } else if (r.tone === "negative" && r.value !== 0) {
                  toneClass = "text-red-600";
                } else if (r.tone === "auto") {
                  toneClass = r.value < 0 ? "text-red-600" : "text-green-600";
                }
                return (
                  <tr
                    key={r.label}
                    className={r.isFinal ? "bg-muted/20" : ""}
                  >
                    <td className="px-6 py-3 align-top">
                      <p
                        className={`truncate ${r.isFinal ? "font-semibold" : "font-medium"}`}
                      >
                        {r.label}
                      </p>
                      {r.note ? (
                        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">
                          {r.note}
                        </p>
                      ) : null}
                    </td>
                    <td
                      className={`px-6 py-3 text-right tabular-nums text-sm ${
                        r.isFinal ? "font-semibold" : ""
                      } ${toneClass}`}
                    >
                      {formatSummaryCurrency(r.value)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function formatSummaryCurrency(n: number): string {
  // Match the rest of the page's currency formatting: leading $, no
  // decimals, locale separators. Negatives render with a minus sign.
  const abs = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return n < 0 ? `-${abs}` : abs;
}

