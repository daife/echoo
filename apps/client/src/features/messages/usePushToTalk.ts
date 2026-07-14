import { useCallback, useEffect, useRef, useState } from "react";
import { startMp3Recorder, type ActiveMp3Recorder } from "./audio/mp3Recorder";

const CANCEL_DISTANCE_PX = 72;
const MAX_RECORDING_SECONDS = 60;
const MIN_RECORDING_SECONDS = 1;

export function isPushToTalkCancelGesture(startY: number, currentY: number) {
  return startY - currentY >= CANCEL_DISTANCE_PX;
}

export type PushToTalkPhase = "idle" | "requesting" | "recording" | "encoding";

export function usePushToTalk(input: {
  disabled?: boolean;
  onRecorded: (blob: Blob, durationSeconds: number) => Promise<void> | void;
  onError: (message: string) => void;
}) {
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
      if (cancel || duration < MIN_RECORDING_SECONDS) {
        await recorder.cancel();
        reset();
        if (!cancel) input.onError("说话时间太短");
        return;
      }
      setPhase("encoding");
      try {
        const result = await recorder.stop();
        reset();
        await input.onRecorded(
          result.blob,
          Math.min(MAX_RECORDING_SECONDS, result.durationSeconds),
        );
      } catch (error) {
        reset();
        input.onError(
          error instanceof Error ? error.message : "语音处理失败。",
        );
      }
    },
    [clearTimers, input, reset],
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
        }, MAX_RECORDING_SECONDS * 1_000);
      } catch (error) {
        if (sessionRef.current !== session) return;
        reset();
        const message =
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "无法使用麦克风，请在系统设置中允许 Echoo 访问。"
            : error instanceof DOMException && error.name === "NotFoundError"
              ? "未找到可用的麦克风。"
              : error instanceof Error
                ? error.message
                : "麦克风启动失败。";
        input.onError(message);
      }
    },
    [input, phase, reset],
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
