import {
  ImageSquare,
  SpinnerGap,
  Trash,
  Waveform,
  X,
} from "@phosphor-icons/react";
import type { SocialPostContentInput, SocialPostSummary } from "@echoo/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { audioBlobToMp3 } from "../../features/messages/audio/mp3Recorder";
import type { SocialService } from "../../services/SocialService";
import { compressImageToJpeg } from "../../shared/utils/imageCompression";
import {
  contentToDraft,
  draftTextLength,
  hasDraftContent,
  insertMediaBlock,
  nextDraftId,
  newTextBlock,
  removeMediaBlock,
  type DraftPostBlock,
} from "./postDraft";

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export function PostComposer({
  service,
  initialPost,
  onSaved,
  onCancel,
}: {
  service: SocialService;
  initialPost?: SocialPostSummary;
  onSaved: (post: SocialPostSummary) => void;
  onCancel?: () => void;
}) {
  const [blocks, setBlocks] = useState<DraftPostBlock[]>(() =>
    contentToDraft(initialPost?.content),
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocksRef = useRef(blocks);
  const textareasRef = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocusIdRef = useRef<string | undefined>(undefined);
  const selectionRef = useRef<{
    blockId: string;
    start: number;
    end: number;
  } | null>(null);

  useEffect(() => {
    blocksRef.current = blocks;
    const focusId = pendingFocusIdRef.current;
    if (!focusId) return;
    pendingFocusIdRef.current = undefined;
    const textarea = textareasRef.current.get(focusId);
    textarea?.focus();
    textarea?.setSelectionRange(0, 0);
  }, [blocks]);
  useEffect(
    () => () => revokeDraftUrls(blocksRef.current),
    [],
  );

  const imageCount = blocks.filter((block) => block.type === "image").length;
  const audioCount = blocks.filter((block) => block.type === "audio").length;
  const textLength = draftTextLength(blocks);
  const rememberSelection = (blockId: string, textarea: HTMLTextAreaElement) => {
    selectionRef.current = {
      blockId,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  };

  const insertFiles = (media: DraftPostBlock[]) => {
    setBlocks((current) => {
      let next = current;
      let selection = selectionRef.current;
      let focusId: string | undefined;
      for (const block of media) {
        if (block.type === "text") continue;
        const inserted = insertMediaBlock(next, selection, block);
        next = inserted.blocks;
        focusId = inserted.focusBlockId;
        selection = focusId ? { blockId: focusId, start: 0, end: 0 } : null;
      }
      selectionRef.current = selection;
      pendingFocusIdRef.current = focusId;
      return next;
    });
  };

  const addImages = async (files: File[]) => {
    const remaining = 3 - imageCount;
    if (remaining <= 0 || !files.length) return;
    if (files.length > remaining) setError("每条动态最多添加 3 张图片。");
    setIsProcessing(true);
    try {
      const compressed = await Promise.all(
        files.slice(0, remaining).map(compressImageToJpeg),
      );
      insertFiles(
        compressed.map((file) => ({
          id: nextDraftId(),
          type: "image" as const,
          source: "file" as const,
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片压缩失败。");
    } finally {
      setIsProcessing(false);
    }
  };

  const addAudio = async (files: File[]) => {
    const remaining = 10 - audioCount;
    if (remaining <= 0 || !files.length) return;
    if (files.length > remaining) setError("每条动态最多添加 10 条语音。");
    setIsProcessing(true);
    try {
      const converted = await Promise.all(
        files.slice(0, remaining).map(async (file) => {
          const result = await audioBlobToMp3(file);
          if (result.durationSeconds < 0.8)
            throw new Error("语音时长不能少于 0.8 秒。");
          if (result.durationSeconds > 60.1)
            throw new Error("语音时长不能超过 60 秒。");
          if (result.blob.size > MAX_AUDIO_BYTES)
            throw new Error("语音转换后不能超过 12MB。");
          const encoded = new File([result.blob], mp3FileName(file.name), {
            type: "audio/mpeg",
            lastModified: file.lastModified,
          });
          return {
            file: encoded,
            durationSeconds: result.durationSeconds,
          };
        }),
      );
      insertFiles(
        converted.map(({ file, durationSeconds }) => ({
          id: nextDraftId(),
          type: "audio" as const,
          source: "file" as const,
          file,
          previewUrl: URL.createObjectURL(file),
          durationSeconds,
        })),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "语音处理失败。");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form
      className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!hasDraftContent(blocks)) return;
        setIsSubmitting(true);
        setError(null);
        try {
          const content = await Promise.all(
            blocks.map(async (block): Promise<SocialPostContentInput> => {
              if (block.type === "text")
                return { type: "text", text: block.text };
              const resourceId =
                block.source === "existing"
                  ? block.resourceId
                  : await service.uploadPostMedia(block.file, block.type);
              return { type: block.type, resourceId };
            }),
          );
          const post = initialPost
            ? await service.updatePost(initialPost.id, content)
            : await service.createPost(content);
          onSaved(post);
          if (!initialPost) {
            revokeDraftUrls(blocks);
            setBlocks([newTextBlock()]);
            selectionRef.current = null;
          }
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "动态发布失败。");
        } finally {
          setIsSubmitting(false);
        }
      }}
    >
      <div className="space-y-3">
        {blocks.map((block, index) =>
          block.type === "text" ? (
            <textarea
              key={block.id}
              ref={(element) => {
                if (element) textareasRef.current.set(block.id, element);
                else textareasRef.current.delete(block.id);
              }}
              value={block.text}
              onChange={(event) => {
                const value = event.target.value;
                const nextLength = textLength - block.text.length + value.length;
                if (nextLength > 4000) {
                  setError("动态正文不能超过 4000 字。");
                  return;
                }
                setBlocks((current) =>
                  current.map((item) =>
                    item.id === block.id && item.type === "text"
                      ? { ...item, text: value }
                      : item,
                  ),
                );
              }}
              onFocus={(event) => rememberSelection(block.id, event.currentTarget)}
              onSelect={(event) => rememberSelection(block.id, event.currentTarget)}
              rows={Math.max(2, block.text.split("\n").length)}
              placeholder={index === 0 ? "分享此刻的想法或插入一段媒体……" : "继续写点什么……"}
              className="w-full resize-none rounded-xl bg-white/[0.025] px-3 py-2 text-sm leading-7 text-white outline-none placeholder:text-white/25 focus:bg-white/[0.04]"
            />
          ) : (
            <div
              key={block.id}
              className="group relative overflow-hidden rounded-xl border border-white/8 bg-black/20"
            >
              {block.type === "image" ? (
                <img
                  src={block.previewUrl}
                  alt="动态图片预览"
                  className="max-h-[420px] w-full object-contain"
                />
              ) : (
                <div className="p-4 pr-14">
                  <div className="mb-2 flex items-center gap-2 text-xs text-white/48">
                    <Waveform size={18} className="text-[#c7b9ed]" />
                    <span>语音预览</span>
                    {block.durationSeconds ? (
                      <span className="ml-auto tabular-nums">
                        {formatDuration(block.durationSeconds)}
                      </span>
                    ) : null}
                  </div>
                  <audio className="h-10 w-full" controls src={block.previewUrl} />
                </div>
              )}
              <button
                type="button"
                aria-label={block.type === "image" ? "移除图片" : "移除语音"}
                onClick={() => {
                  if (block.source === "file") URL.revokeObjectURL(block.previewUrl);
                  setBlocks((current) => removeMediaBlock(current, block.id));
                }}
                className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white/80 transition hover:text-white"
              >
                <Trash size={14} />
              </button>
            </div>
          ),
        )}
      </div>

      {error ? <p className="mt-3 text-xs text-red-200/80">{error}</p> : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
        <div className="flex flex-wrap items-center gap-4">
          <MediaInput
            icon={isProcessing ? <SpinnerGap size={17} className="animate-spin" /> : <ImageSquare size={18} />}
            label={`图片 ${imageCount}/3`}
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={isProcessing || isSubmitting || imageCount >= 3}
            onFiles={addImages}
          />
          <MediaInput
            icon={isProcessing ? <SpinnerGap size={17} className="animate-spin" /> : <Waveform size={18} />}
            label={`语音 ${audioCount}/10`}
            accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,audio/opus,.mp3,.wav,.m4a,.opus"
            disabled={isProcessing || isSubmitting || audioCount >= 10}
            onFiles={addAudio}
          />
          <span className="text-[11px] tabular-nums text-white/25">
            {textLength}/4000
          </span>
        </div>
        <div className="flex gap-2">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="grid h-9 w-9 place-items-center rounded-full text-white/45 hover:bg-white/5 hover:text-white"
            >
              <X size={16} />
            </button>
          ) : null}
          <button
            type="submit"
            disabled={isSubmitting || isProcessing || !hasDraftContent(blocks)}
            className="rounded-full bg-white px-5 py-2 text-xs font-medium text-black disabled:opacity-35"
          >
            {isSubmitting ? "正在保存…" : initialPost ? "保存修改" : "发布动态"}
          </button>
        </div>
      </div>
    </form>
  );
}

function MediaInput({
  icon,
  label,
  accept,
  disabled,
  onFiles,
}: {
  icon: ReactNode;
  label: string;
  accept: string;
  disabled: boolean;
  onFiles: (files: File[]) => Promise<void>;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-white/48 transition hover:text-white has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40">
      {icon}
      {label}
      <input
        className="sr-only"
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          void onFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function revokeDraftUrls(blocks: DraftPostBlock[]) {
  for (const block of blocks)
    if (block.type !== "text" && block.source === "file")
      URL.revokeObjectURL(block.previewUrl);
}

function mp3FileName(fileName: string) {
  const base = fileName.trim().replace(/\.[^./\\]+$/, "") || "voice";
  return `${base}.mp3`;
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
