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
const ILINK_APP_ID = "bot";
const CHANNEL_VERSION = "0.1.0";
const ILINK_APP_CLIENT_VERSION = 0x00000100;
const MESSAGE_TYPE_BOT = 2;
const MESSAGE_STATE_FINISH = 2;

type WechatAccountCredentials = { baseUrl: string; botToken: string };
type LoginAttempt = {
  qrcode: string;
  qrcodeUrl?: string;
  baseUrl: string;
  createdAt: number;
  status: "wait" | "connected" | "expired";
  account?: WechatLoginResult["account"];
};

const attempts = new Map<string, LoginAttempt>();

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

function apiBaseInfo() {
  return {
    channel_version: CHANNEL_VERSION,
    bot_agent: `Echoo/${CHANNEL_VERSION}`,
  };
}

function randomWechatUin() {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function commonHeaders() {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
}

function postHeaders(token?: string) {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...commonHeaders(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function endpointUrl(baseUrl: string, endpoint: string) {
  return `${baseUrl.replace(/\/$/, "")}/${endpoint}`;
}

function assertSuccess(response: any, endpoint: string) {
  if (typeof response?.ret === "number" && response.ret !== 0)
    throw new Error(
      `微信接口 ${endpoint} 返回 ret=${response.ret}: ${response.errmsg ?? "未知错误"}`,
    );
}

async function requestPost(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>,
  token?: string,
  signal?: AbortSignal,
) {
  const response = await fetch(endpointUrl(baseUrl, endpoint), {
    method: "POST",
    headers: postHeaders(token),
    body: JSON.stringify({ ...body, base_info: apiBaseInfo() }),
    signal,
  });
  if (!response.ok)
    throw new Error(`微信接口 ${endpoint} 返回 HTTP ${response.status}`);
  const value = (await response.json()) as any;
  assertSuccess(value, endpoint);
  return value;
}

async function requestGet(baseUrl: string, endpoint: string) {
  const response = await fetch(endpointUrl(baseUrl, endpoint), {
    method: "GET",
    headers: commonHeaders(),
  });
  if (!response.ok)
    throw new Error(`微信接口 ${endpoint} 返回 HTTP ${response.status}`);
  const value = (await response.json()) as any;
  assertSuccess(value, endpoint);
  return value;
}

function normalizeRedirectHost(host: string) {
  return /^https?:\/\//.test(host) ? host : `https://${host}`;
}

function stableClientId(value: string) {
  const uuid = value.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  )?.[0];
  if (uuid) return uuid.toLowerCase();
  const digest = createHash("sha256").update(value).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export class WechatClient {
  async startLogin(baseUrl = DEFAULT_BASE_URL): Promise<WechatLoginResult> {
    const response = await requestPost(
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
    return { attemptId, qrcodeUrl, status: "wait" };
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

    const response = await requestGet(
      attempt.baseUrl,
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(attempt.qrcode)}`,
    );
    if (
      response.status === "scaned_but_redirect" &&
      typeof response.redirect_host === "string"
    )
      attempt.baseUrl = normalizeRedirectHost(response.redirect_host);
    if (response.status === "confirmed" && typeof response.bot_token === "string") {
      attempt.status = "connected";
      attempt.account = {
        accountId: response.ilink_bot_id ?? randomUUID(),
        botToken: response.bot_token,
        baseUrl: response.baseurl ?? attempt.baseUrl,
        ...(response.ilink_user_id
          ? { externalUserId: response.ilink_user_id }
          : {}),
      };
    } else if (response.status === "expired") attempt.status = "expired";
    return {
      attemptId,
      qrcodeUrl: attempt.qrcodeUrl,
      status: attempt.status,
      account: attempt.account,
    };
  }

  async getUpdates(
    account: WechatAccountCredentials,
    syncBuf: string,
    signal?: AbortSignal,
  ) {
    return requestPost(
      account.baseUrl,
      "ilink/bot/getupdates",
      { get_updates_buf: syncBuf },
      account.botToken,
      signal,
    );
  }

  async sendText(
    account: WechatAccountCredentials,
    to: string,
    text: string,
    clientId: string = randomUUID(),
  ) {
    await requestPost(
      account.baseUrl,
      "ilink/bot/sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: to,
          client_id: stableClientId(clientId),
          message_type: MESSAGE_TYPE_BOT,
          message_state: MESSAGE_STATE_FINISH,
          item_list: [{ type: 1, text_item: { text } }],
        },
      },
      account.botToken,
    );
  }

  async downloadImage(account: WechatAccountCredentials, item: any) {
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
    account: WechatAccountCredentials,
    to: string,
    data: Buffer,
    clientId: string = randomUUID(),
  ) {
    const aesKey = randomBytes(16);
    const cipher = createCipheriv("aes-128-ecb", aesKey, null);
    cipher.setAutoPadding(true);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const filekey = randomBytes(16).toString("hex");
    const upload = await requestPost(
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
    await requestPost(
      account.baseUrl,
      "ilink/bot/sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: to,
          client_id: stableClientId(clientId),
          message_type: MESSAGE_TYPE_BOT,
          message_state: MESSAGE_STATE_FINISH,
          item_list: [
            {
              type: 2,
              image_item: {
                media: {
                  encrypt_query_param: encryptedParam,
                  aes_key: Buffer.from(aesKey.toString("hex")).toString(
                    "base64",
                  ),
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
  }
}

export const wechatClient = new WechatClient();
