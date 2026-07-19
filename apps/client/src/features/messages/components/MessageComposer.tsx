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
  VideoCamera,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { PrimeFigureSticker } from "@echoo/shared";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { compressImageToJpeg } from "../../../shared/utils/imageCompression";
import { usePushToTalk } from "../usePushToTalk";
import { MediaAsset } from "../../media/MediaAsset";
import {
  resolveTextSubmission,
  shouldSubmitTextBeforeInput,
  shouldSubmitTextInput,
} from "./messageComposerSubmission";

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/mov",
  "video/mpeg",
]);
const MAX_VIDEO_UPLOAD_BYTES = 12 * 1024 * 1024;
export function MessageComposer({
  title,
  isPrimeFigure,
  draft,
  isSending,
  onDraftChange,
  onSendText,
  onSendImage,
  onSendVideo,
  onSendVoice,
  stickers,
  onSendSticker,
  onSendTransfer,
  onAddSticker,
  onDeleteSticker,
}: {
  title: string;
  isPrimeFigure: boolean;
  draft: string;
  isSending: boolean;
  onDraftChange: (value: string) => void;
  onSendText: (text: string) => Promise<void> | void;
  onSendImage: (file: File) => Promise<void>;
  onSendVideo: (file: File) => Promise<void>;
  onSendVoice: (blob: Blob, durationSeconds: number) => Promise<void>;
  stickers: PrimeFigureSticker[];
  onSendSticker: (stickerId: string) => Promise<void> | void;
  onSendTransfer: (amount: number, note?: string) => Promise<void> | void;
  onAddSticker: (file: File, description: string) => Promise<void>;
  onDeleteSticker: (stickerId: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [panel, setPanel] = useState<"more" | "stickers" | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
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
  const [deletingStickerId, setDeletingStickerId] = useState<string | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastTextSubmissionAtRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const stickerFileInputRef = useRef<HTMLInputElement | null>(null);
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
    setSelectedVideo(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (videoInputRef.current) videoInputRef.current.value = "";
  };

  const selectVideo = (file?: File) => {
    if (!file) return;
    const mimeType = resolveVideoMimeType(file);
    if (!mimeType) {
      setNotice("请选择 MP4、WebM、MOV 或 MPEG 视频。");
      return;
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setNotice("视频大小不能超过 12MB。");
      return;
    }
    const normalized =
      file.type === mimeType
        ? file
        : new File([file], file.name, {
            type: mimeType,
            lastModified: file.lastModified,
          });
    setNotice(null);
    setSelectedImage(null);
    setSelectedVideo(normalized);
    setPreviewUrl(URL.createObjectURL(normalized));
    setPanel(null);
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
      setSelectedVideo(null);
      setSelectedImage(compressed);
      setPreviewUrl(URL.createObjectURL(compressed));
      setPanel(null);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "图片压缩失败。");
    } finally {
      setIsCompressingImage(false);
    }
  };

  const selectSticker = async (file?: File) => {
    if (!file) return;
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      setNotice("请选择 JPEG、PNG、WebP 或 GIF 图片。");
      return;
    }
    setNotice(null);
    setIsCompressingImage(true);
    try {
      // Decode while the native file-picker handle is still live. Some
      // WebViews invalidate delayed File reads after the picker is dismissed.
      setPendingStickerFile(await compressImageToJpeg(file));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "图片压缩失败。");
    } finally {
      setIsCompressingImage(false);
      if (stickerFileInputRef.current) stickerFileInputRef.current.value = "";
    }
  };

  const isRecording =
    pushToTalk.phase === "recording" || pushToTalk.phase === "requesting";

  const submitText = () => {
    const text = resolveTextSubmission(inputRef.current?.value, draft);
    if (!text || isSending) return;
    const now = Date.now();
    const previousSubmissionAt = Number(lastTextSubmissionAtRef.current) || 0;
    if (now - previousSubmissionAt < 500) return;
    lastTextSubmissionAtRef.current = now;
    try {
      void Promise.resolve(onSendText(text)).catch((caught) => {
        setNotice(caught instanceof Error ? caught.message : "发送消息失败。");
      });
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "发送消息失败。");
    }
  };

  const handleTextKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (
      !shouldSubmitTextInput({
        key: event.key,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.keyCode,
      })
    )
      return;
    event.preventDefault();
    void submitText();
  };

  const handleTextBeforeInput = (event: FormEvent<HTMLInputElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (
      !shouldSubmitTextBeforeInput({
        inputType: nativeEvent.inputType,
        isComposing: nativeEvent.isComposing,
      })
    )
      return;
    event.preventDefault();
    submitText();
  };

  const handleSendPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    submitText();
  };

  return (
    <footer className="relative w-full min-w-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 md:px-6 md:pb-6">
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-16 bg-gradient-to-t from-[#0d0d10] to-transparent" />
      {(selectedImage || selectedVideo) && previewUrl ? (
        <div className="mb-2 flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-[#151519] p-3 shadow-[0_14px_38px_rgba(0,0,0,0.24)]">
          {selectedVideo ? (
            <video
              className="h-16 w-16 rounded-lg bg-black object-cover"
              src={previewUrl}
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              className="h-16 w-16 rounded-lg object-cover"
              src={previewUrl}
              alt="待发送图片预览"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white/82">
              {(selectedImage ?? selectedVideo)?.name}
            </p>
            <p className="mt-1 text-xs tabular-nums text-white/38">
              {formatFileSize((selectedImage ?? selectedVideo)!.size)}
            </p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-lg text-white/38 transition hover:bg-white/[0.06] hover:text-white"
            type="button"
            aria-label={selectedVideo ? "取消发送视频" : "取消发送图片"}
            onClick={clearImage}
          >
            <X size={16} />
          </button>
          <button
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/88 disabled:opacity-40"
            type="button"
            disabled={isSending}
            onClick={() => {
              const file = selectedImage ?? selectedVideo;
              clearImage();
              if (!file) return;
              if (selectedVideo) void onSendVideo(file);
              else void onSendImage(file);
            }}
          >
            {selectedVideo ? "发送视频" : "发送图片"}
          </button>
        </div>
      ) : null}
      <form
        className="flex w-full min-w-0 items-center gap-1.5 rounded-xl border border-white/10 bg-[#121216] p-2 shadow-[0_14px_38px_rgba(0,0,0,0.22)] transition focus-within:border-white/30 sm:gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submitText();
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
            enterKeyHint="send"
            type="text"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onCompositionEnd={(event) => {
              onDraftChange(event.currentTarget.value);
            }}
            onBeforeInput={handleTextBeforeInput}
            onKeyDown={handleTextKeyDown}
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
            type="button"
            onPointerDown={handleSendPointerDown}
            onClick={submitText}
          >
            <PaperPlaneRight size={18} weight="fill" />
          </button>
        ) : null}
      </form>
      {panel === "more" && isPrimeFigure ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-[#151519] p-3 shadow-[0_18px_44px_rgba(0,0,0,0.3)]">
          <div className="grid grid-cols-4 gap-2 sm:w-[26rem]">
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
              onClick={() => videoInputRef.current?.click()}
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/[0.065] text-white/74">
                <VideoCamera size={23} weight="duotone" />
              </span>
              视频
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
              const input = event.currentTarget;
              const file = input.files?.[0];
              void selectImage(file).finally(() => {
                input.value = "";
              });
            }}
          />
          <input
            ref={videoInputRef}
            className="sr-only"
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/mov,video/mpeg,.mov"
            onChange={(event) => {
              selectVideo(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </div>
      ) : null}
      {panel === "stickers" && isPrimeFigure ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-[#151519] p-3 shadow-[0_18px_44px_rgba(0,0,0,0.3)]">
          <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            {stickers.map((sticker) => (
              <div
                key={sticker.resourceId}
                className="group relative aspect-square overflow-hidden rounded-xl bg-white/[0.04] p-1 transition hover:bg-white/[0.1]"
              >
                <button
                  className="h-full w-full"
                  type="button"
                  title={sticker.description}
                  disabled={deletingStickerId === sticker.resourceId}
                  onClick={() => {
                    setPanel(null);
                    void onSendSticker(sticker.resourceId);
                  }}
                >
                  <MediaAsset
                    className="h-full w-full object-contain"
                    mediaUrl={sticker.resourcePath}
                    variant="thumb"
                    alt={sticker.description}
                  />
                </button>
                <button
                  className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-lg bg-black/70 text-white/65 opacity-100 transition hover:bg-red-500/80 hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
                  type="button"
                  aria-label={`删除表情：${sticker.description}`}
                  disabled={deletingStickerId !== null}
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (
                      !window.confirm(
                        "删除后服务端不会保留该表情，确定继续吗？",
                      )
                    )
                      return;
                    setDeletingStickerId(sticker.resourceId);
                    setNotice(null);
                    try {
                      await onDeleteSticker(sticker.resourceId);
                    } catch (caught) {
                      setNotice(
                        caught instanceof Error
                          ? caught.message
                          : "表情删除失败。",
                      );
                    } finally {
                      setDeletingStickerId(null);
                    }
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <label
              className={`grid aspect-square place-items-center rounded-xl border border-dashed border-white/15 text-white/45 transition ${stickers.length >= 20 ? "opacity-35" : "cursor-pointer hover:border-white/30 hover:text-white"}`}
            >
              <UploadSimple size={20} />
              <input
                ref={stickerFileInputRef}
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={stickers.length >= 20 || isCompressingImage}
                onChange={(event) => {
                  void selectSticker(event.currentTarget.files?.[0]);
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
                if (stickerFileInputRef.current)
                  stickerFileInputRef.current.value = "";
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
                  if (stickerFileInputRef.current)
                    stickerFileInputRef.current.value = "";
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

function resolveVideoMimeType(file: File) {
  if (VIDEO_MIME_TYPES.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "mp4" || extension === "m4v") return "video/mp4";
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  if (extension === "mpeg" || extension === "mpg") return "video/mpeg";
  return null;
}

function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function isValidTransferAmount(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) && Number(value) > 0;
}
