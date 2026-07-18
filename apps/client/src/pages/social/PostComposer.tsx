import { ImageSquare, SpinnerGap, Trash, X } from "@phosphor-icons/react";
import type { SocialPostSummary } from "@echoo/shared";
import { useEffect, useRef, useState } from "react";
import type { SocialService } from "../../services/SocialService";
import { compressImageToJpeg } from "../../shared/utils/imageCompression";

type DraftImage =
  | { kind: "existing"; resourceId: string; previewUrl: string }
  | { kind: "file"; file: File; previewUrl: string };

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
  const [body, setBody] = useState(initialPost?.body ?? "");
  const [images, setImages] = useState<DraftImage[]>(() =>
    (initialPost?.images ?? []).map((image) => ({
      kind: "existing",
      resourceId: image.resourceId,
      previewUrl: image.resourcePath,
    })),
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imagesRef = useRef(images);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(
    () => () => {
      for (const image of imagesRef.current)
        if (image.kind === "file") URL.revokeObjectURL(image.previewUrl);
    },
    [],
  );

  const addFiles = async (files: File[]) => {
    const remaining = 3 - images.length;
    if (remaining <= 0 || !files.length) return;
    if (files.length > remaining) setError("每条动态最多添加 3 张图片。");
    setIsProcessing(true);
    try {
      const compressed = await Promise.all(
        files.slice(0, remaining).map(compressImageToJpeg),
      );
      setImages((current) => [
        ...current,
        ...compressed.map((file) => ({
          kind: "file" as const,
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片压缩失败。");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form
      className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!body.trim() && !images.length) return;
        setIsSubmitting(true);
        setError(null);
        try {
          const resourceIds = await Promise.all(
            images.map((image) =>
              image.kind === "existing"
                ? Promise.resolve(image.resourceId)
                : service.uploadPostImage(image.file),
            ),
          );
          const post = initialPost
            ? await service.updatePost(initialPost.id, body, resourceIds)
            : await service.createPost(body, resourceIds);
          onSaved(post);
          if (!initialPost) {
            for (const image of images)
              if (image.kind === "file") URL.revokeObjectURL(image.previewUrl);
            setBody("");
            setImages([]);
          }
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "动态发布失败。");
        } finally {
          setIsSubmitting(false);
        }
      }}
    >
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={4000}
        rows={initialPost ? 5 : 4}
        placeholder="分享此刻的想法、创作过程或一张图片……"
        className="w-full resize-none bg-transparent text-sm leading-7 text-white outline-none placeholder:text-white/28"
      />
      {images.length ? (
        <div
          className={`mt-4 grid gap-2 ${images.length === 1 ? "grid-cols-1" : "grid-cols-3"}`}
        >
          {images.map((image, index) => (
            <div
              key={`${image.previewUrl}:${index}`}
              className="group relative aspect-square overflow-hidden rounded-xl bg-black/20"
            >
              <img
                src={image.previewUrl}
                alt="动态图片预览"
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label="移除图片"
                onClick={() => {
                  if (image.kind === "file")
                    URL.revokeObjectURL(image.previewUrl);
                  setImages((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  );
                }}
                className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white opacity-80 transition hover:opacity-100"
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs text-red-200/80">{error}</p> : null}
      <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-4">
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-white/48 transition hover:text-white">
            {isProcessing ? (
              <SpinnerGap size={17} className="animate-spin" />
            ) : (
              <ImageSquare size={18} />
            )}
            {isProcessing ? "正在压缩" : `添加图片 ${images.length}/3`}
            <input
              className="sr-only"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={isProcessing || isSubmitting || images.length >= 3}
              onChange={(event) => {
                void addFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </label>
          <span className="text-[11px] tabular-nums text-white/25">
            {body.length}/4000
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
            disabled={
              isSubmitting || isProcessing || (!body.trim() && !images.length)
            }
            className="rounded-full bg-white px-5 py-2 text-xs font-medium text-black disabled:opacity-35"
          >
            {isSubmitting ? "正在保存…" : initialPost ? "保存修改" : "发布动态"}
          </button>
        </div>
      </div>
    </form>
  );
}
