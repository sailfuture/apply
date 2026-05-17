import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { getDocumentDownloadUrl } from "@/lib/pandadoc";

/**
 * Admin-side proxy for downloading signed PandaDoc PDFs (enrollment
 * agreements + liability waivers). Mirrors the parent-side
 * `/api/pandadoc/download` route but gated on admin auth instead of
 * the Clerk family ownership check — admins need to view PDFs across
 * every family, not just their own.
 *
 * Why a proxy at all: the URL stored on Xano (`*_pdf_url`) points at
 * `https://api.pandadoc.com/public/v1/documents/{id}/download`, which
 * requires the PandaDoc API key in the `Authorization` header. The
 * admin's browser doesn't have that key, so hitting the stored URL
 * directly returns
 *   `{"type":"authentication_error","detail":"Authentication credentials were not provided."}`
 * This proxy fetches the PDF server-side (with our API key), then
 * streams the bytes back to the admin's browser as a plain
 * `application/pdf` response — same shape the parent-side proxy
 * uses.
 *
 * Usage:
 *   GET /api/admin/pandadoc/download?documentId=<pandadoc id>
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const documentId = req.nextUrl.searchParams.get("documentId");
    if (!documentId) {
      return NextResponse.json(
        { error: "documentId is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.PANDADOC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "PANDADOC_API_KEY is not set" },
        { status: 500 }
      );
    }

    const url = getDocumentDownloadUrl(documentId);
    const res = await fetch(url, {
      headers: {
        Authorization: `API-Key ${apiKey}`,
      },
      redirect: "follow",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        {
          error: `PandaDoc download failed (${res.status}): ${text}`,
        },
        { status: 502 }
      );
    }

    const pdfBuffer = await res.arrayBuffer();

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // `inline` lets the browser preview the PDF when admin opens
        // it in a new tab; the file gets the document id as the
        // filename so saves don't all collide on `download.pdf`.
        "Content-Disposition": `inline; filename="${documentId}.pdf"`,
      },
    });
  } catch (err) {
    return handleAdminError(err);
  }
}
