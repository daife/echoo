import type { UserProfile } from "@echoo/shared";

interface ResendEmailBody {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

export class EmailService {
  async sendVerificationEmail(user: UserProfile, verificationUrl: string) {
    return this.sendAuthEmail({
      user,
      url: verificationUrl,
      subject: "Verify your Echoo account",
      title: "Verify your email",
      body: `Hi ${escapeHtml(user.displayName)}, confirm this email address to activate your Echoo account. This link expires in 24 hours.`,
      action: "Verify email",
      skippedMessage: "Verification email skipped",
    });
  }

  async sendPasswordResetEmail(user: UserProfile, resetUrl: string) {
    return this.sendAuthEmail({
      user,
      url: resetUrl,
      subject: "Reset your Echoo password",
      title: "Reset your password",
      body: `Hi ${escapeHtml(user.displayName)}, use the link below to set a new password. This link expires in 30 minutes.`,
      action: "Choose a new password",
      skippedMessage: "Password reset email skipped",
    });
  }

  private async sendAuthEmail(input: {
    user: UserProfile;
    url: string;
    subject: string;
    title: string;
    body: string;
    action: string;
    skippedMessage: string;
  }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from =
      process.env.RESEND_FROM_EMAIL ?? "Echoo <onboarding@resend.dev>";
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;background:#09090b;color:#e5e2e1;padding:32px">
        <div style="max-width:520px;margin:0 auto;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:28px;background:rgba(255,255,255,.04)">
          <p style="letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.48);font-size:12px">Echoo account</p>
          <h1 style="font-size:28px;margin:12px 0;color:#fff">${input.title}</h1>
          <p style="line-height:1.6;color:rgba(255,255,255,.7)">${input.body}</p>
          <p style="margin:28px 0"><a href="${input.url}" style="display:inline-block;background:#fff;color:#09090b;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700">${input.action}</a></p>
          <p style="font-size:12px;line-height:1.6;color:rgba(255,255,255,.38)">If you did not request this, you can ignore this email.</p>
        </div>
      </div>
    `;

    if (!apiKey) {
      console.info(
        `${input.skippedMessage}; RESEND_API_KEY is not set. URL: ${input.url}`,
      );
      return;
    }

    const body: ResendEmailBody = {
      from,
      to: [input.user.email],
      subject: input.subject,
      html,
    };

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      console.warn(`Resend auth email failed: ${response.status} ${detail}`);
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
