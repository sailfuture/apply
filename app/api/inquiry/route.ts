import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { WelcomeInquiryEmail } from "@/lib/emails/welcome-inquiry";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
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
        { status: 400 }
      );
    }

    const xanoBaseUrl = process.env.XANO_API_BASE_URL;
    if (!xanoBaseUrl) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
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
        { status: 502 }
      );
    }

    const inquiry = await xanoRes.json();

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://apply.sailfutureacademy.org";

    const { error: emailError } = await resend.emails.send({
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
      console.error("Resend error:", emailError);
    }

    return NextResponse.json(
      { message: "Inquiry received", id: inquiry.id },
      { status: 201 }
    );
  } catch (err) {
    console.error("Inquiry error:", err);
    return NextResponse.json(
      { error: "Failed to process inquiry" },
      { status: 500 }
    );
  }
}
