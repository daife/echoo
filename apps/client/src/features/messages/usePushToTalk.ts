import { useCallback, useEffect, useRef, useState } from "react";
import { startMp3Recorder, type ActiveMp3Recorder } from "./audio/mp3Recorder";

const CANCEL_DISTANCE_PX = 72;
const DEFAULT_MAX_RECORDING_SECONDS = 60;
const DEFAULT_MIN_RECORDING_SECONDS = 1;

export function isPushToTalkCancelGesture(startY: number, currentY: number) {
  return startY - currentY >= CANCEL_DISTANCE_PX;
}

export type PushToTalkPhase = "idle" | "requesting" | "recording" | "encoding";

export function usePushToTalk(input: {
  disabled?: boolean;
  onRecorded: (blob: Blob, durationSeconds: number) => Promise<void> | void;
  onError: (message: string) => void;
  maxRecordingSeconds?: number;
  minRecordingSeconds?: number;
}) {
  const maxRecordingSeconds = Math.max(1, Math.min(120, input.maxRecordingSeconds ?? DEFAULT_MAX_RECORDING_SECONDS));
  const minRecordingSeconds = Math.max(
    0,
    Math.min(maxRecordingSeconds, input.minRecordingSeconds ?? DEFAULT_MIN_RECORDING_SECONDS),
  );
  const [phase, setPhase] = useState<PushToTalkPhase>("idle");
  const [level, setLevel] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isCancelArmed, setIsCancelArmed] = useState(false);
  const recorderRef = useRef<ActiveMp3Recorder | null>(null);
  const heldRef = useRef(false);
  const startYRef = useRef(0);
  const cancelArmedRef = useRef(false);
  const sessionRef = useRef(0);
  const durationTimerRef = useRef<number | null>(null);
  const maximumTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (durationTimerRef.current !== null)
      window.clearInterval(durationTimerRef.current);
    if (maximumTimerRef.current !== null)
      window.clearTimeout(maximumTimerRef.current);
    durationTimerRef.current = null;
    maximumTimerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    heldRef.current = false;
    recorderRef.current = null;
    cancelArmedRef.current = false;
    setIsCancelArmed(false);
    setDurationSeconds(0);
    setLevel(0);
    setPhase("idle");
  }, [clearTimers]);

  const finish = useCallback(
    async (cancel: boolean) => {
      heldRef.current = false;
      const recorder = recorderRef.current;
      if (!recorder) {
        sessionRef.current += 1;
        reset();
        return;
      }
      clearTimers();
      const duration = recorder.getDurationSeconds();
      if (cancel || duration < minRecordingSeconds) {
        await recorder.cancel();
        reset();
        if (!cancel)
          input.onError(
            minRecordingSeconds === 1
              ? "说话时间太短"
              : `录音不能少于 ${minRecordingSeconds} 秒。`,
          );
        return;
      }
      setPhase("encoding");
      try {
        const result = await recorder.stop();
        reset();
        await input.onRecorded(
          result.blob,
          Math.min(maxRecordingSeconds, result.durationSeconds),
        );
      } catch (error) {
        reset();
        input.onError(
          error instanceof Error ? error.message : "语音处理失败。",
        );
      }
    },
    [clearTimers, input, maxRecordingSeconds, minRecordingSeconds, reset],
  );
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const beginHold = useCallback(
    async (clientY: number) => {
      if (input.disabled || phase !== "idle") return;
      const session = sessionRef.current + 1;
      sessionRef.current = session;
      heldRef.current = true;
      startYRef.current = clientY;
      cancelArmedRef.current = false;
      setIsCancelArmed(false);
      setDurationSeconds(0);
      setPhase("requesting");
      try {
        const recorder = await startMp3Recorder(setLevel);
        if (sessionRef.current !== session || !heldRef.current) {
          await recorder.cancel();
          return;
        }
        recorderRef.current = recorder;
        setPhase("recording");
        durationTimerRef.current = window.setInterval(
          () => setDurationSeconds(recorder.getDurationSeconds()),
          100,
        );
        maximumTimerRef.current = window.setTimeout(() => {
          void finishRef.current(cancelArmedRef.current);
        }, maxRecordingSeconds * 1_000);
      } catch (error) {
        if (sessionRef.current !== session) return;
        reset();
        const message = describeMicrophoneError(error);
        input.onError(message);
      }
    },
    [input, maxRecordingSeconds, phase, reset],
  );

  const moveHold = useCallback((clientY: number) => {
    if (!heldRef.current) return;
    const next = isPushToTalkCancelGesture(startYRef.current, clientY);
    if (next === cancelArmedRef.current) return;
    cancelArmedRef.current = next;
    setIsCancelArmed(next);
  }, []);

  const endHold = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = false;
    if (!recorderRef.current) {
      sessionRef.current += 1;
      reset();
      return;
    }
    void finish(cancelArmedRef.current);
  }, [finish, reset]);

  const cancel = useCallback(() => {
    heldRef.current = false;
    sessionRef.current += 1;
    const recorder = recorderRef.current;
    if (recorder) void recorder.cancel();
    reset();
  }, [reset]);

  useEffect(() => {
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, [cancel]);

  useEffect(
    () => () => {
      heldRef.current = false;
      sessionRef.current += 1;
      clearTimers();
      void recorderRef.current?.cancel();
    },
    [clearTimers],
  );

  return {
    phase,
    level,
    durationSeconds,
    isCancelArmed,
    beginHold,
    moveHold,
    endHold,
    cancel,
  };
}

export function describeMicrophoneError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError")
      return "无法使用麦克风，请允许浏览器访问麦克风后重试。";
    if (error.name === "NotFoundError") return "未找到可用的麦克风。";
    if (error.name === "NotReadableError")
      return "麦克风正被其他应用占用，请关闭占用后重试。";
    if (error.name === "AbortError") return "麦克风启动被中断，请重试。";
  }
  return error instanceof Error ? error.message : "麦克风启动失败。";
}
