import * as React from "react";

interface WelcomeInquiryEmailProps {
  parentFirstName: string;
  studentFirstName: string;
  studentLastName: string;
  signUpUrl: string;
}

export function WelcomeInquiryEmail({
  parentFirstName,
  studentFirstName,
  studentLastName,
  signUpUrl,
}: WelcomeInquiryEmailProps) {
  return (
    <div
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        maxWidth: "600px",
        margin: "0 auto",
        padding: "0",
        backgroundColor: "#ffffff",
      }}
    >
      <div
        style={{
          backgroundColor: "#1a1a2e",
          padding: "32px 24px",
          textAlign: "center" as const,
        }}
      >
        <h1
          style={{
            color: "#ffffff",
            fontSize: "24px",
            fontWeight: 700,
            margin: 0,
            letterSpacing: "-0.025em",
          }}
        >
          SailFuture Academy
        </h1>
      </div>

      <div style={{ padding: "40px 24px" }}>
        <h2
          style={{
            fontSize: "22px",
            fontWeight: 600,
            color: "#1a1a2e",
            margin: "0 0 16px 0",
          }}
        >
          Welcome, {parentFirstName}!
        </h2>

        <p
          style={{
            fontSize: "16px",
            lineHeight: "1.6",
            color: "#374151",
            margin: "0 0 16px 0",
          }}
        >
          Thank you for your interest in SailFuture Academy for{" "}
          <strong>
            {studentFirstName} {studentLastName}
          </strong>
          . We&apos;re excited to learn more about your family and share what
          makes our program unique.
        </p>

        <p
          style={{
            fontSize: "16px",
            lineHeight: "1.6",
            color: "#374151",
            margin: "0 0 24px 0",
          }}
        >
          The next step is to create your account on our Registration Portal.
          From there, you&apos;ll be able to complete the full application,
          upload any required documents, and track your progress.
        </p>

        <div style={{ textAlign: "center" as const, margin: "32px 0" }}>
          <a
            href={signUpUrl}
            style={{
              display: "inline-block",
              backgroundColor: "#1a1a2e",
              color: "#ffffff",
              fontSize: "16px",
              fontWeight: 600,
              textDecoration: "none",
              padding: "14px 32px",
              borderRadius: "8px",
            }}
          >
            Begin Your Application
          </a>
        </div>

        <p
          style={{
            fontSize: "14px",
            lineHeight: "1.6",
            color: "#6b7280",
            margin: "24px 0 0 0",
          }}
        >
          If you have any questions, feel free to reach out to our admissions
          team at{" "}
          <a
            href="mailto:admissions@sailfutureacademy.org"
            style={{ color: "#1a1a2e" }}
          >
            admissions@sailfutureacademy.org
          </a>
          .
        </p>
      </div>

      <div
        style={{
          borderTop: "1px solid #e5e7eb",
          padding: "24px",
          textAlign: "center" as const,
        }}
      >
        <p
          style={{
            fontSize: "12px",
            color: "#9ca3af",
            margin: 0,
          }}
        >
          SailFuture Academy &middot; St. Petersburg, FL
        </p>
      </div>
    </div>
  );
}
