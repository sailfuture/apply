const PANDADOC_API_BASE = "https://api.pandadoc.com/public/v1";

function getApiKey(): string {
  const key = process.env.PANDADOC_API_KEY;
  if (!key) throw new Error("PANDADOC_API_KEY is not set");
  return key;
}

function headers() {
  return {
    Authorization: `API-Key ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

interface CreateDocumentParams {
  templateId: string;
  name: string;
  recipientEmail: string;
  recipientFirstName: string;
  recipientLastName: string;
  /** Name of the role on the PandaDoc template that the recipient
   *  fills. PandaDoc rejects the document create with
   *  `non_field_errors: Role 'X' does not exist` when the role
   *  name doesn't match exactly. Default of `"Client"` matches
   *  the current SailFuture templates (renamed from "Parent" to
   *  "Client" in May 2026); configure
   *  `PANDADOC_LIABILITY_ROLE` / `PANDADOC_ENROLLMENT_ROLE` via
   *  the env to override per template, and pass `getTemplateRole(type)`
   *  in here from the caller. */
  role?: string;
  /** Non-signing recipients who get a copy of the document. PandaDoc
   *  decides signer-vs-CC purely by the presence of `role` — per their
   *  spec, "a recipient will be added in CC if a role parameter is not
   *  provided" — so these are emitted with the role omitted. There is
   *  no `recipient_type` field to set. */
  cc?: Array<{ email: string; firstName?: string; lastName?: string }>;
  /** Plain-text tokens (mail-merge style) — replace `{{token.name}}`
   *  placeholders in the document content. Use for prose references
   *  the signer doesn't interact with. */
  tokens?: Record<string, string>;
  /** Form-field prefills — populate interactive fields the signer
   *  would otherwise type into (e.g. "Participant Name", "Parent
   *  Email"). Keyed by the field's `name` attribute in the PandaDoc
   *  template; values are stringified. Distinct from tokens — a
   *  field's pre-filled value is editable by the signer in the
   *  signing UI, whereas tokens are baked into the doc text. */
  fields?: Record<string, string>;
  /** Document metadata echoed back on every webhook event for this
   *  document. We stamp family/year/student/type so the webhook can
   *  map a status change straight to the owning Xano row without a
   *  lookup. */
  metadata?: Record<string, string>;
}

interface PandaDocDocument {
  id: string;
  name: string;
  status: string;
  date_created: string;
  date_modified: string;
}

interface PandaDocSession {
  id: string;
  expires_at: string;
}

export async function createDocumentFromTemplate(
  params: CreateDocumentParams
): Promise<PandaDocDocument> {
  const body: Record<string, unknown> = {
    name: params.name,
    template_uuid: params.templateId,
    recipients: [
      {
        email: params.recipientEmail,
        first_name: params.recipientFirstName,
        last_name: params.recipientLastName,
        role: params.role ?? "Client",
      },
      // CC recipients — role deliberately omitted, which is the ONLY
      // thing that distinguishes them from a signer. Anyone already on
      // as the signer is dropped: PandaDoc rejects the create when the
      // same address appears twice in `recipients`.
      ...(params.cc ?? [])
        .filter(
          (c) =>
            c.email &&
            c.email.trim().toLowerCase() !==
              params.recipientEmail.trim().toLowerCase()
        )
        .map((c) => ({
          email: c.email.trim(),
          first_name: c.firstName ?? "",
          last_name: c.lastName ?? "",
        })),
    ],
    tokens: params.tokens
      ? Object.entries(params.tokens).map(([name, value]) => ({
          name,
          value,
        }))
      : [],
  };

  // PandaDoc expects fields as an object keyed by the template
  // field's name, with each value an object containing `value` (and
  // optionally `role`, but role-binding the recipient already
  // covers that). Only emit the `fields` key when there's at least
  // one prefill to send — PandaDoc rejects empty `fields: {}`.
  if (params.fields && Object.keys(params.fields).length > 0) {
    body.fields = Object.fromEntries(
      Object.entries(params.fields).map(([name, value]) => [
        name,
        { value },
      ])
    );
  }

  if (params.metadata && Object.keys(params.metadata).length > 0) {
    body.metadata = params.metadata;
  }

  const res = await fetch(`${PANDADOC_API_BASE}/documents`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PandaDoc create failed (${res.status}): ${text}`);
  }

  return res.json();
}

export interface SendDocumentOptions {
  /** `true` (the default) moves the envelope to `sent` WITHOUT
   *  emailing anyone. That's right for the parent-side flow, which
   *  hands the signer an embedded session in the app moments later —
   *  a PandaDoc email there would just be a confusing second path to
   *  the same signature. Admin-initiated sends flip this to `false`
   *  so PandaDoc emails the recipient its own signing link, which is
   *  the entire point when the family has stopped opening the portal. */
  silent?: boolean;
  /** Body of PandaDoc's email. Ignored when `silent` is true. */
  message?: string;
  /** Subject line of PandaDoc's email. Ignored when `silent` is true. */
  subject?: string;
}

export async function sendDocument(
  documentId: string,
  options: SendDocumentOptions = {}
): Promise<void> {
  const {
    silent = true,
    message = "Please review and sign this document.",
    subject,
  } = options;
  const body: Record<string, unknown> = { message, silent };
  if (subject) body.subject = subject;

  const res = await fetch(
    `${PANDADOC_API_BASE}/documents/${documentId}/send`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PandaDoc send failed (${res.status}): ${text}`);
  }
}

/**
 * Move a document to `deleted`.
 *
 * Used when admin re-sends a waiver: the fresh envelope replaces the
 * unsigned one, and leaving the old link live is actively dangerous —
 * the family could sign it, and the webhook's id guard (which only
 * accepts the document id currently on the packet row) would drop
 * that completion on the floor. A signature nobody records is worse
 * than no signature at all.
 *
 * Treats 404 as success: an envelope that's already gone is the state
 * we wanted.
 */
export async function deleteDocument(documentId: string): Promise<void> {
  const res = await fetch(`${PANDADOC_API_BASE}/documents/${documentId}`, {
    method: "DELETE",
    headers: headers(),
  });

  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`PandaDoc delete failed (${res.status}): ${text}`);
  }
}

/**
 * Poll until a document reaches `targetStatus`. Checks BEFORE the
 * first sleep (the transition is often already done by the time we
 * ask) and uses a short interval that ramps up: uploaded→draft
 * usually lands in 1-3s, so a fixed 2s step wasted up to 2s per call.
 * Default budget ≈ 25s total (well inside the route's maxDuration).
 */
export async function waitForDocumentStatus(
  documentId: string,
  targetStatus: string,
  opts: { initialMs?: number; maxMs?: number; timeoutMs?: number } = {}
): Promise<PandaDocDocument> {
  const initialMs = opts.initialMs ?? 400;
  const maxMs = opts.maxMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const start = Date.now();
  let interval = initialMs;
  // First check happens immediately (no leading sleep).
  for (;;) {
    const doc = await getDocumentStatus(documentId);
    if (doc.status === targetStatus) return doc;
    if (Date.now() - start >= timeoutMs) {
      throw new Error(
        `Document ${documentId} did not reach status "${targetStatus}" within ${Math.round(
          timeoutMs / 1000
        )}s (last status: ${doc.status})`
      );
    }
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(Math.round(interval * 1.5), maxMs);
  }
}

export async function getDocumentStatus(
  documentId: string
): Promise<PandaDocDocument> {
  const res = await fetch(
    `${PANDADOC_API_BASE}/documents/${documentId}`,
    {
      method: "GET",
      headers: headers(),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PandaDoc status failed (${res.status}): ${text}`);
  }

  return res.json();
}

interface PandaDocRecipient {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  has_completed?: boolean;
}

interface PandaDocDocumentDetails extends PandaDocDocument {
  recipients?: PandaDocRecipient[];
}

/**
 * Full document details — includes the recipient roster, which the
 * basic `getDocumentStatus` (which hits `/documents/{id}`) omits.
 * Lets the create route detect a name/email mismatch between the
 * envelope's stored recipient and the Clerk user currently logged
 * in (e.g. envelope was created with a primary parent's name baked
 * in, but a different parent is now trying to sign), so we can
 * force a fresh-create instead of resuming a doc with the wrong
 * person stamped on it.
 */
export async function getDocumentDetails(
  documentId: string
): Promise<PandaDocDocumentDetails> {
  const res = await fetch(
    `${PANDADOC_API_BASE}/documents/${documentId}/details`,
    {
      method: "GET",
      headers: headers(),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PandaDoc details failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function createSigningSession(
  documentId: string,
  recipientEmail: string
): Promise<string> {
  const res = await fetch(
    `${PANDADOC_API_BASE}/documents/${documentId}/session`,
    {
      method: "POST",
      headers: headers(),
      // 1-hour lifetime (was 15 min). A parent who reads carefully
      // through a long waiver used to have their session expire
      // mid-signature with no recovery path; an hour comfortably
      // covers a slow read.
      body: JSON.stringify({ recipient: recipientEmail, lifetime: 3600 }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PandaDoc session failed (${res.status}): ${text}`);
  }

  const session: PandaDocSession = await res.json();
  return session.id;
}

export function getDocumentDownloadUrl(documentId: string): string {
  return `${PANDADOC_API_BASE}/documents/${documentId}/download`;
}

export function getTemplateId(
  type: "liability_waiver" | "enrollment_agreement"
): string {
  const envVar =
    type === "liability_waiver"
      ? "PANDADOC_LIABILITY_TEMPLATE_ID"
      : "PANDADOC_ENROLLMENT_TEMPLATE_ID";
  const id = process.env[envVar];
  if (!id) throw new Error(`${envVar} is not set`);
  if (id.startsWith("your_")) {
    throw new Error(
      `${envVar} is still set to a placeholder value. Please update it with your actual PandaDoc template ID.`
    );
  }
  return id;
}

/**
 * Resolve the recipient role name configured on a PandaDoc template.
 * Each template has its own role name (PandaDoc rejects the create
 * with `Role 'X' does not exist` when the name doesn't match
 * exactly), so we expose a per-type env var:
 *   - `PANDADOC_LIABILITY_ROLE` — defaults to "Client"
 *   - `PANDADOC_ENROLLMENT_ROLE` — defaults to "Client"
 *
 * Override either env var when the template was authored with a
 * different role name (common: "Recipient", "Signer", "Parent").
 * Default is "Client" because the SailFuture templates were renamed
 * from "Parent" to "Client" in May 2026 — keeping the default in
 * sync with the live templates means the code Just Works even if
 * the env var hasn't propagated through Vercel after a deploy.
 */
/**
 * Addresses CC'd on an admin-sent waiver so the office keeps a copy
 * of what went out and of the signed result, without anyone having
 * to remember to forward it.
 *
 * Comma-separated `PANDADOC_WAIVER_CC`, defaulting to the admissions
 * inbox — same convention as `RESEND_REPLY_TO` in lib/emails/resend.
 * Set it to a single space to turn CC off entirely.
 */
export function getWaiverCcRecipients(): Array<{ email: string }> {
  const raw =
    process.env.PANDADOC_WAIVER_CC ?? "admissions@sailfuture.org";
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"))
    .map((email) => ({ email }));
}

export function getTemplateRole(
  type: "liability_waiver" | "enrollment_agreement"
): string {
  const envVar =
    type === "liability_waiver"
      ? "PANDADOC_LIABILITY_ROLE"
      : "PANDADOC_ENROLLMENT_ROLE";
  const role = process.env[envVar]?.trim();
  return role && role.length > 0 ? role : "Client";
}
