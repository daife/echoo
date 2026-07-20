import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import QRCode from "qrcode";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const attempts = new Map<
  string,
  {
    qrcode: string;
    qrcodeUrl?: string;
    baseUrl: string;
    createdAt: number;
    status: "wait" | "connected" | "expired";
    account?: {
      accountId: string;
      botToken: string;
      baseUrl: string;
      externalUserId?: string;
    };
  }
>();

export interface WechatLoginResult {
  attemptId: string;
  qrcodeUrl?: string;
  status: "wait" | "connected" | "expired";
  account?: {
    accountId: string;
    botToken: string;
    baseUrl: string;
    externalUserId?: string;
  };
}

async function request(
  baseUrl: string,
  endpoint: string,
  body?: unknown,
  token?: string,
) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok)
    throw new Error(`微信接口 ${endpoint} 返回 ${response.status}`);
  return (await response.json()) as any;
}

export class WechatClient {
  async startLogin(baseUrl = DEFAULT_BASE_URL): Promise<WechatLoginResult> {
    const response = await request(
      baseUrl,
      "ilink/bot/get_bot_qrcode?bot_type=3",
      { local_token_list: [] },
    );
    if (
      typeof response.qrcode !== "string" ||
      typeof response.qrcode_img_content !== "string"
    )
      throw new Error("微信接口未返回有效的登录二维码");

    const qrcodeUrl = await QRCode.toDataURL(response.qrcode_img_content, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 416,
    });
    const attemptId = randomUUID();
    attempts.set(attemptId, {
      qrcode: response.qrcode,
      qrcodeUrl,
      baseUrl,
      createdAt: Date.now(),
      status: "wait",
    });
    return {
      attemptId,
      qrcodeUrl,
      status: "wait",
    };
  }

  async pollLogin(attemptId: string): Promise<WechatLoginResult | null> {
    const attempt = attempts.get(attemptId);
    if (!attempt) return null;
    if (attempt.status === "connected" || attempt.status === "expired")
      return {
        attemptId,
        qrcodeUrl: attempt.qrcodeUrl,
        status: attempt.status,
        account: attempt.account,
      };
    if (Date.now() - attempt.createdAt > 10 * 60_000) {
      attempt.status = "expired";
      return { attemptId, qrcodeUrl: attempt.qrcodeUrl, status: "expired" };
    }
    const response = await request(
      attempt.baseUrl,
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(attempt.qrcode)}`,
    );
    if (response.status === "confirmed" || response.status === "scaned") {
      if (response.bot_token) {
        attempt.status = "connected";
        attempt.account = {
          accountId: response.account_id ?? randomUUID(),
          botToken: response.bot_token,
          baseUrl: response.base_url ?? DEFAULT_BASE_URL,
          ...(response.ilink_user_id
            ? { externalUserId: response.ilink_user_id }
            : {}),
        };
      }
    } else if (response.status === "expired") attempt.status = "expired";
    return {
      attemptId,
      qrcodeUrl: attempt.qrcodeUrl,
      status: attempt.status,
      account: attempt.account,
    };
  }

  async getUpdates(
    account: { baseUrl: string; botToken: string },
    syncBuf: string,
    signal?: AbortSignal,
  ) {
    const response = await fetch(
      `${account.baseUrl.replace(/\/$/, "")}/ilink/bot/getupdates`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${account.botToken}`,
        },
        body: JSON.stringify({
          get_updates_buf: syncBuf,
          base_info: { channel_version: "echoo/0.1.0" },
        }),
        signal,
      },
    );
    if (!response.ok)
      throw new Error(`微信 getupdates 返回 ${response.status}`);
    return (await response.json()) as any;
  }

  async sendText(
    account: { baseUrl: string; botToken: string },
    to: string,
    text: string,
    clientId = randomUUID(),
  ) {
    const response = await request(
      account.baseUrl,
      "ilink/bot/sendmessage",
      {
        msg: {
          to_user_id: to,
          client_id: clientId,
          item_list: [{ type: 1, text_item: { text } }],
        },
      },
      account.botToken,
    );
    if (response.ret && response.ret !== 0)
      throw new Error(
        response.errmsg ?? `微信 sendmessage ret=${response.ret}`,
      );
  }

  async downloadImage(
    account: { baseUrl: string; botToken: string },
    item: any,
  ) {
    const media = item?.image_item?.media;
    if (!media) throw new Error("微信图片缺少媒体信息");
    const url =
      media.full_url ??
      `${DEFAULT_CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param ?? "")}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`微信 CDN 下载返回 ${response.status}`);
    const encrypted = Buffer.from(await response.arrayBuffer());
    const imageKey = item.image_item.aeskey;
    const mediaKey = media.aes_key;
    if (!imageKey && !mediaKey) return encrypted;
    const decoded = imageKey
      ? Buffer.from(imageKey, "hex")
      : Buffer.from(mediaKey, "base64");
    const key =
      decoded.length === 16
        ? decoded
        : Buffer.from(decoded.toString("ascii"), "hex");
    const decipher = createDecipheriv("aes-128-ecb", key, null);
    decipher.setAutoPadding(true);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  async sendImage(
    account: { baseUrl: string; botToken: string },
    to: string,
    data: Buffer,
    clientId = randomUUID(),
  ) {
    const aesKey = randomBytes(16);
    const cipher = createCipheriv("aes-128-ecb", aesKey, null);
    cipher.setAutoPadding(true);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const filekey = randomBytes(16).toString("hex");
    const upload = await request(
      account.baseUrl,
      "ilink/bot/getuploadurl",
      {
        filekey,
        media_type: 1,
        to_user_id: to,
        rawsize: data.length,
        rawfilemd5: createHash("md5").update(data).digest("hex"),
        filesize: encrypted.length,
        no_need_thumb: true,
        aeskey: aesKey.toString("hex"),
      },
      account.botToken,
    );
    if (!upload.upload_full_url && !upload.upload_param)
      throw new Error("微信 getuploadurl 未返回上传地址");
    const uploadUrl =
      upload.upload_full_url ??
      `${DEFAULT_CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(upload.upload_param)}&filekey=${encodeURIComponent(filekey)}`;
    const uploaded = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(encrypted),
    });
    if (!uploaded.ok) throw new Error(`微信 CDN 上传返回 ${uploaded.status}`);
    const encryptedParam = uploaded.headers.get("x-encrypted-param");
    if (!encryptedParam) throw new Error("微信 CDN 上传缺少 x-encrypted-param");
    const sent = await request(
      account.baseUrl,
      "ilink/bot/sendmessage",
      {
        msg: {
          to_user_id: to,
          client_id: clientId,
          item_list: [
            {
              type: 2,
              image_item: {
                media: {
                  encrypt_query_param: encryptedParam,
                  aes_key: aesKey.toString("base64"),
                  encrypt_type: 1,
                },
                mid_size: encrypted.length,
              },
            },
          ],
        },
      },
      account.botToken,
    );
    if (sent.ret && sent.ret !== 0)
      throw new Error(sent.errmsg ?? `微信 sendmessage ret=${sent.ret}`);
  }
}

export const wechatClient = new WechatClient();
