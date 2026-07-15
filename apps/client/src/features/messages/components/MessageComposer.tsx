import {
  ImageSquare,
  Keyboard,
  Money,
  Microphone,
  PaperPlaneRight,
  Phone,
  Plus,
  Smiley,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { PrimeFigureSticker } from "@echoo/shared";
import { useEffect, useRef, useState } from "react";
import { compressImageToJpeg } from "../../../shared/utils/imageCompression";
import { usePushToTalk } from "../usePushToTalk";

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
export function MessageComposer({
  title,
  isPrimeFigure,
  draft,
  isSending,
  onDraftChange,
  onSendText,
  onSendImage,
  onSendVoice,
  stickers,
  onSendSticker,
  onSendTransfer,
  onAddSticker,
}: {
  title: string;
  isPrimeFigure: boolean;
  draft: string;
  isSending: boolean;
  onDraftChange: (value: string) => void;
  onSendText: () => Promise<void> | void;
  onSendImage: (file: File) => Promise<void>;
  onSendVoice: (blob: Blob, durationSeconds: number) => Promise<void>;
  stickers: PrimeFigureSticker[];
  onSendSticker: (stickerId: string) => Promise<void> | void;
  onSendTransfer: (amount: number, note?: string) => Promise<void> | void;
  onAddSticker: (file: File, description: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [panel, setPanel] = useState<"more" | "stickers" | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCompressingImage, setIsCompressingImage] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [stickerDescription, setStickerDescription] = useState("");
  const [pendingStickerFile, setPendingStickerFile] = useState<File | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pushToTalk = usePushToTalk({
    disabled: isSending,
    onRecorded: onSendVoice,
    onError: setNotice,
  });

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (isPrimeFigure) return;
    pushToTalk.cancel();
    setMode("text");
    setPanel(null);
    setNotice(null);
  }, [isPrimeFigure]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanel(null);
        setIsTransferOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  const clearImage = () => {
    setSelectedImage(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const selectImage = async (file?: File) => {
    if (!file) return;
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      setNotice("请选择 JPEG、PNG、WebP 或 GIF 图片。");
      return;
    }
    setNotice(null);
    setIsCompressingImage(true);
    try {
      const compressed = await compressImageToJpeg(file);
      setSelectedImage(compressed);
      setPreviewUrl(URL.createObjectURL(compressed));
      setPanel(null);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "图片压缩失败。");
    } finally {
      setIsCompressingImage(false);
    }
  };

  const isRecording =
    pushToTalk.phase === "recording" || pushToTalk.phase === "requesting";

  return (
    <footer className="relative px-4 pb-4 pt-2 md:px-6 md:pb-6">
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-16 bg-gradient-to-t from-[#0d0d10] to-transparent" />
      {selectedImage && previewUrl ? (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-white/10 bg-[#151519] p-3 shadow-[0_14px_38px_rgba(0,0,0,0.24)]">
          <img
            className="h-16 w-16 rounded-lg object-cover"
            src={previewUrl}
            alt="待发送图片预览"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white/82">
              {selectedImage.name}
            </p>
            <p className="mt-1 text-xs tabular-nums text-white/38">
              {formatFileSize(selectedImage.size)}
            </p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-lg text-white/38 transition hover:bg-white/[0.06] hover:text-white"
            type="button"
            aria-label="取消发送图片"
            onClick={clearImage}
          >
            <X size={16} />
          </button>
          <button
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/88 disabled:opacity-40"
            type="button"
            disabled={isSending}
            onClick={() => {
              const file = selectedImage;
              clearImage();
              void onSendImage(file);
            }}
          >
            发送图片
          </button>
        </div>
      ) : null}
      <form
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#121216] p-2 shadow-[0_14px_38px_rgba(0,0,0,0.22)] transition focus-within:border-white/30"
        onSubmit={(event) => {
          event.preventDefault();
          void onSendText();
          window.requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        {isPrimeFigure ? (
          <button
            className="grid h-10 w-10 flex-none place-items-center rounded-lg text-white/48 transition hover:bg-white/[0.06] hover:text-white"
            type="button"
            aria-label={mode === "text" ? "切换到语音" : "切换到键盘"}
            onClick={() => {
              pushToTalk.cancel();
              setMode((current) => (current === "text" ? "voice" : "text"));
              setPanel(null);
              setNotice(null);
            }}
          >
            {mode === "text" ? (
              <Microphone size={20} />
            ) : (
              <Keyboard size={20} />
            )}
          </button>
        ) : null}
        {mode === "voice" && isPrimeFigure ? (
          <button
            className={`min-w-0 flex-1 touch-none select-none rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              pushToTalk.isCancelArmed
                ? "bg-red-400/12 text-red-100"
                : isRecording
                  ? "bg-white/[0.11] text-white"
                  : "bg-white/[0.045] text-white/78 hover:bg-white/[0.07]"
            }`}
            type="button"
            disabled={isSending || pushToTalk.phase === "encoding"}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setNotice(null);
              void pushToTalk.beginHold(event.clientY);
            }}
            onPointerMove={(event) => pushToTalk.moveHold(event.clientY)}
            onPointerUp={() => pushToTalk.endHold()}
            onPointerCancel={() => pushToTalk.cancel()}
          >
            {pushToTalk.phase === "requesting"
              ? "等待麦克风授权…"
              : pushToTalk.phase === "encoding"
                ? "正在生成 MP3…"
                : pushToTalk.isCancelArmed
                  ? "松开取消"
                  : isRecording
                    ? "松开发送"
                    : "按住说话"}
          </button>
        ) : (
          <input
            ref={inputRef}
            aria-label={`给 ${title} 发消息`}
            className="min-w-0 flex-1 border-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/32"
            placeholder="写下消息，Enter 发送"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
        )}
        {isPrimeFigure && mode === "text" ? (
          <button
            className={`grid h-10 w-10 flex-none place-items-center rounded-lg transition ${
              panel === "stickers"
                ? "bg-white/[0.1] text-white"
                : "text-white/48 hover:bg-white/[0.06] hover:text-white"
            }`}
            type="button"
            aria-label="表情"
            aria-expanded={panel === "stickers"}
            onClick={() =>
              setPanel((current) =>
                current === "stickers" ? null : "stickers",
              )
            }
          >
            <Smiley size={21} />
          </button>
        ) : null}
        {isPrimeFigure && mode === "text" && !draft.trim() ? (
          <button
            className={`grid h-10 w-10 flex-none place-items-center rounded-lg transition ${
              panel === "more"
                ? "bg-white/[0.1] text-white"
                : "text-white/48 hover:bg-white/[0.06] hover:text-white"
            }`}
            type="button"
            aria-label="更多消息类型"
            aria-expanded={panel === "more"}
            onClick={() => {
              setPanel((current) => (current === "more" ? null : "more"));
              setNotice(null);
            }}
          >
            <Plus
              className={`transition-transform ${panel === "more" ? "rotate-45" : ""}`}
              size={21}
            />
          </button>
        ) : null}
        {mode === "text" && draft.trim() ? (
          <button
            aria-label="发送消息"
            className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-white text-[#09090b] transition hover:bg-white/88 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!draft.trim() || isSending}
            type="submit"
          >
            <PaperPlaneRight size={18} weight="fill" />
          </button>
        ) : null}
      </form>
      {panel === "more" && isPrimeFigure ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-[#151519] p-3 shadow-[0_18px_44px_rgba(0,0,0,0.3)]">
          <div className="grid grid-cols-3 gap-2 sm:w-80">
            <button
              className="flex w-24 flex-col items-center gap-2 rounded-xl p-2 text-xs text-white/55 transition hover:bg-white/[0.055] hover:text-white"
              type="button"
              disabled={isCompressingImage}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/[0.065] text-white/74">
                <ImageSquare size={23} weight="duotone" />
              </span>
              {isCompressingImage ? "压缩中…" : "图片"}
            </button>
            <button
              className="flex flex-col items-center gap-2 rounded-xl p-2 text-xs text-white/55 transition hover:bg-white/[0.055] hover:text-white"
              type="button"
              onClick={() => {
                setIsTransferOpen(true);
                setPanel(null);
              }}
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/[0.065] text-white/74">
                <Money size={23} weight="duotone" />
              </span>
              转账
            </button>
            <button
              className="flex flex-col items-center gap-2 rounded-xl p-2 text-xs text-white/28"
              type="button"
              disabled
              title="语音通话即将推出"
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/[0.035]">
                <Phone size={23} weight="duotone" />
              </span>
              语音通话
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={isCompressingImage}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void selectImage(file);
            }}
          />
        </div>
      ) : null}
      {panel === "stickers" && isPrimeFigure ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-[#151519] p-3 shadow-[0_18px_44px_rgba(0,0,0,0.3)]">
          <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            {stickers.map((sticker) => (
              <button
                key={sticker.resourceId}
                className="aspect-square overflow-hidden rounded-xl bg-white/[0.04] p-1 transition hover:bg-white/[0.1]"
                type="button"
                title={sticker.description}
                onClick={() => {
                  setPanel(null);
                  void onSendSticker(sticker.resourceId);
                }}
              >
                <img
                  className="h-full w-full object-contain"
                  src={sticker.resourcePath}
                  alt={sticker.description}
                />
              </button>
            ))}
            <label
              className={`grid aspect-square place-items-center rounded-xl border border-dashed border-white/15 text-white/45 transition ${stickers.length >= 20 ? "opacity-35" : "cursor-pointer hover:border-white/30 hover:text-white"}`}
            >
              <UploadSimple size={20} />
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={stickers.length >= 20}
                onChange={(event) => {
                  setPendingStickerFile(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {stickers.length === 0 ? (
            <p className="mt-3 text-xs text-white/35">
              还没有表情，点击加号上传第一个。
            </p>
          ) : null}
        </div>
      ) : null}
      {isTransferOpen ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-[#151519] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white">发起转账</span>
            <button
              type="button"
              className="text-white/40 hover:text-white"
              onClick={() => setIsTransferOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr_auto]">
            <input
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              placeholder="金额（CNY）"
              value={transferAmount}
              onChange={(event) => setTransferAmount(event.target.value)}
            />
            <input
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
              maxLength={120}
              placeholder="备注（可选）"
              value={transferNote}
              onChange={(event) => setTransferNote(event.target.value)}
            />
            <button
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-35"
              type="button"
              disabled={isSending || !isValidTransferAmount(transferAmount)}
              onClick={() => {
                const amount = Number(transferAmount);
                setIsTransferOpen(false);
                setTransferAmount("");
                setTransferNote("");
                void onSendTransfer(amount, transferNote.trim() || undefined);
              }}
            >
              转账
            </button>
          </div>
        </div>
      ) : null}
      {pendingStickerFile ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-[#151519] p-4">
          <p className="text-sm font-medium text-white">添加表情描述</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
              maxLength={200}
              autoFocus
              placeholder="这个表情表达什么？"
              value={stickerDescription}
              onChange={(event) => setStickerDescription(event.target.value)}
            />
            <button
              className="rounded-lg px-3 py-2 text-sm text-white/55 hover:text-white"
              type="button"
              onClick={() => {
                setPendingStickerFile(null);
                setStickerDescription("");
              }}
            >
              取消
            </button>
            <button
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-35"
              type="button"
              disabled={isSending || !stickerDescription.trim()}
              onClick={async () => {
                const file = pendingStickerFile;
                try {
                  await onAddSticker(file, stickerDescription.trim());
                  setPendingStickerFile(null);
                  setStickerDescription("");
                } catch (caught) {
                  setNotice(
                    caught instanceof Error ? caught.message : "表情添加失败。",
                  );
                }
              }}
            >
              添加
            </button>
          </div>
        </div>
      ) : null}
      {isRecording ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center bg-black/12 pb-32 backdrop-blur-[1px] md:pb-36">
          <div
            className={`flex min-w-48 flex-col items-center rounded-2xl border px-7 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)] transition ${
              pushToTalk.isCancelArmed
                ? "border-red-300/20 bg-[#2a1719]/96"
                : "border-white/10 bg-[#17171b]/96"
            }`}
          >
            <div className="flex h-10 items-center gap-1.5">
              {[0.65, 1, 0.78, 0.92, 0.58].map((weight, index) => (
                <span
                  key={index}
                  className={`w-1.5 rounded-full transition-[height,background-color] duration-100 ${
                    pushToTalk.isCancelArmed ? "bg-red-200/80" : "bg-white/75"
                  }`}
                  style={{
                    height: `${8 + Math.max(0.08, pushToTalk.level) * 28 * weight}px`,
                  }}
                />
              ))}
            </div>
            <span className="mt-2 text-sm tabular-nums text-white/82">
              {formatDuration(pushToTalk.durationSeconds)}
            </span>
            <span
              className={`mt-1 text-xs ${pushToTalk.isCancelArmed ? "text-red-100/75" : "text-white/38"}`}
            >
              {pushToTalk.isCancelArmed ? "松开取消" : "上滑取消"}
            </span>
          </div>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-red-200/78">
          <WarningCircle size={13} />
          {notice}
        </div>
      ) : null}
    </footer>
  );
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.min(60, Math.floor(seconds));
  return `${Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0")}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function isValidTransferAmount(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) && Number(value) > 0;
}
