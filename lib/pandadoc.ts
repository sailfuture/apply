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
  tokens?: Record<string, string>;
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
  const body = {
    name: params.name,
    template_uuid: params.templateId,
    recipients: [
      {
        email: params.recipientEmail,
        first_name: params.recipientFirstName,
        last_name: params.recipientLastName,
        role: "Parent",
      },
    ],
    tokens: params.tokens
      ? Object.entries(params.tokens).map(([name, value]) => ({
          name,
          value,
        }))
      : [],
  };

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

export async function sendDocument(documentId: string): Promise<void> {
  const res = await fetch(
    `${PANDADOC_API_BASE}/documents/${documentId}/send`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ message: "Please review and sign this document.", silent: true }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PandaDoc send failed (${res.status}): ${text}`);
  }
}

export async function waitForDocumentStatus(
  documentId: string,
  targetStatus: string,
  maxAttempts = 15,
  intervalMs = 2000,
): Promise<PandaDocDocument> {
  for (let i = 0; i < maxAttempts; i++) {
    const doc = await getDocumentStatus(documentId);
    if (doc.status === targetStatus) return doc;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Document ${documentId} did not reach status "${targetStatus}" after ${maxAttempts} attempts`
  );
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

export async function createSigningSession(
  documentId: string,
  recipientEmail: string
): Promise<string> {
  const res = await fetch(
    `${PANDADOC_API_BASE}/documents/${documentId}/session`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ recipient: recipientEmail, lifetime: 900 }),
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
