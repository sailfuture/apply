import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { WelcomeInquiryEmail } from "@/lib/emails/welcome-inquiry";

const ALLOWED_ORIGINS = [
  "https://www.sailfuture.org",
  "https://sailfuture.org",
];

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const body = await req.json();

    const {
      primary_first_name,
      primary_last_name,
      primary_email,
      primary_phone,
      student_first_name,
      student_last_name,
      current_grade,
      starting_grade,
      previous_school,
      about_student,
      hear_about_us,
    } = body;

    if (!primary_email || !primary_first_name) {
      return NextResponse.json(
        { error: "primary_email and primary_first_name are required" },
        { status: 400, headers: cors }
      );
    }

    const xanoBaseUrl = process.env.XANO_API_BASE_URL;
    if (!xanoBaseUrl) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500, headers: cors }
      );
    }

    const xanoRes = await fetch(`${xanoBaseUrl}/registration_inquiry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primary_first_name: primary_first_name ?? "",
        primary_last_name: primary_last_name ?? "",
        primary_email: primary_email ?? "",
        primary_phone: primary_phone ?? "",
        student_first_name: student_first_name ?? "",
        student_last_name: student_last_name ?? "",
        current_grade: current_grade ?? "",
        starting_grade: starting_grade ?? "",
        previous_school: previous_school ?? "",
        about_student: about_student ?? "",
        hear_about_us: hear_about_us ?? "",
      }),
    });

    if (!xanoRes.ok) {
      const errText = await xanoRes.text();
      console.error("Xano error:", errText);
      return NextResponse.json(
        { error: "Failed to save inquiry" },
        { status: 502, headers: cors }
      );
    }

    const inquiry = await xanoRes.json();

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org";

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: "SailFuture Academy Admissions <admissions@sailfutureacademy.org>",
      to: primary_email,
      subject: `Welcome to SailFuture Academy, ${primary_first_name}!`,
      react: WelcomeInquiryEmail({
        parentFirstName: primary_first_name,
        studentFirstName: student_first_name ?? "",
        studentLastName: student_last_name ?? "",
        signUpUrl: `${appUrl}/sign-up`,
      }),
    });

    if (emailError) {
      console.error("Resend error:", JSON.stringify(emailError));
      return NextResponse.json(
        {
          message: "Inquiry saved but email failed",
          id: inquiry.id,
          emailError,
        },
        { status: 201, headers: cors }
      );
    }

    return NextResponse.json(
      { message: "Inquiry received", id: inquiry.id, emailId: emailData?.id },
      { status: 201, headers: cors }
    );
  } catch (err) {
    console.error("Inquiry error:", err);
    return NextResponse.json(
      { error: "Failed to process inquiry" },
      { status: 500, headers: cors }
    );
  }
}
