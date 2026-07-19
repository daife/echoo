import type { UserProfile } from "@echoo/shared";
import { environment } from "../../infra/config/environment.js";

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
      subject: "验证你的 Echoo 账户",
      title: "验证你的邮箱",
      body: `你好，${escapeHtml(user.displayName)}，请确认此邮箱地址以激活你的 Echoo 账户。此链接将在 24 小时后失效。`,
      action: "验证邮箱",
      skippedMessage: "验证邮件未发送",
    });
  }

  async sendPasswordResetEmail(user: UserProfile, resetUrl: string) {
    return this.sendAuthEmail({
      user,
      url: resetUrl,
      subject: "重置你的 Echoo 密码",
      title: "重置你的密码",
      body: `你好，${escapeHtml(user.displayName)}，请使用下面的链接设置新密码。此链接将在 30 分钟后失效。`,
      action: "设置新密码",
      skippedMessage: "密码重置邮件未发送",
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
    const apiKey = environment.resendApiKey;
    const from = environment.resendFromEmail;
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;background:#09090b;color:#e5e2e1;padding:32px">
        <div style="max-width:520px;margin:0 auto;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:28px;background:rgba(255,255,255,.04)">
          <p style="letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.48);font-size:12px">Echoo account</p>
          <h1 style="font-size:28px;margin:12px 0;color:#fff">${input.title}</h1>
          <p style="line-height:1.6;color:rgba(255,255,255,.7)">${input.body}</p>
          <p style="margin:28px 0"><a href="${input.url}" style="display:inline-block;background:#fff;color:#09090b;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700">${input.action}</a></p>
          <p style="font-size:12px;line-height:1.6;color:rgba(255,255,255,.38)">如果这不是你本人发起的操作，可以忽略此邮件。</p>
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
