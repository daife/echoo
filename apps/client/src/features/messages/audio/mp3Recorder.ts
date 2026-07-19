const OUTPUT_SAMPLE_RATE = 44_100;
const OUTPUT_BITRATE_KBPS = 64;
const MP3_BLOCK_SIZE = 1_152;

export interface Mp3RecordingResult {
  blob: Blob;
  durationSeconds: number;
}

export interface ActiveMp3Recorder {
  getDurationSeconds(): number;
  stop(): Promise<Mp3RecordingResult>;
  cancel(): Promise<void>;
}

export interface BrowserAudioCapabilities {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  hasAudioContext: boolean;
}

export function getBrowserAudioCapabilities(): BrowserAudioCapabilities {
  return {
    isSecureContext: globalThis.isSecureContext === true,
    hasGetUserMedia:
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function",
    hasAudioContext:
      typeof window !== "undefined" &&
      Boolean(
        window.AudioContext ??
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext,
      ),
  };
}

export function getMicrophoneUnavailableMessage(
  capabilities: BrowserAudioCapabilities,
) {
  if (!capabilities.isSecureContext)
    return "当前局域网 HTTP 页面可以正常使用文字聊天，但浏览器禁止它访问麦克风。录音需要可信 HTTPS、localhost 或原生客户端。";
  if (!capabilities.hasGetUserMedia)
    return "当前浏览器未提供麦克风录音接口，请升级浏览器或更换浏览器。";
  if (!capabilities.hasAudioContext)
    return "当前浏览器不支持音频采集，请升级浏览器或更换浏览器。";
  return null;
}

export async function startMp3Recorder(
  onLevel?: (level: number) => void,
): Promise<ActiveMp3Recorder> {
  const unavailableMessage = getMicrophoneUnavailableMessage(
    getBrowserAudioCapabilities(),
  );
  if (unavailableMessage) throw new Error(unavailableMessage);

  const stream = await navigator.mediaDevices!.getUserMedia({
    audio: {
      channelCount: { ideal: 1 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  // Capability validation above guarantees this constructor exists.
  if (!AudioContextClass) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("当前浏览器不支持音频采集。");
  }

  const context = new AudioContextClass();
  await context.resume();
  if (typeof MediaRecorder !== "undefined") {
    try {
      return startNativeMediaRecorder(stream, context, onLevel);
    } catch {
      // Older WebViews may expose MediaRecorder without a usable audio codec.
      // Keep the Web Audio recorder below as a compatibility fallback.
    }
  }
  const source = context.createMediaStreamSource(stream);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  silentGain.connect(context.destination);
  const chunks: Float32Array[] = [];
  let sampleCount = 0;
  let stopped = false;
  let workletUrl: string | undefined;
  let captureNode: AudioNode;

  const acceptSamples = (samples: Float32Array) => {
    const copy = new Float32Array(samples);
    chunks.push(copy);
    sampleCount += copy.length;
    if (onLevel) {
      let sum = 0;
      for (let index = 0; index < copy.length; index += 1) {
        const sample = copy[index] ?? 0;
        sum += sample * sample;
      }
      onLevel(Math.min(1, Math.sqrt(sum / Math.max(1, copy.length)) * 4.5));
    }
  };

  if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
    workletUrl = URL.createObjectURL(
      new Blob([createPcmCaptureWorkletSource()], { type: "text/javascript" }),
    );
    try {
      await context.audioWorklet.addModule(workletUrl);
      const worklet = new AudioWorkletNode(context, "echoo-pcm-capture");
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) =>
        acceptSamples(event.data);
      captureNode = worklet;
    } catch {
      captureNode = createScriptProcessor(context, acceptSamples);
    }
  } else {
    captureNode = createScriptProcessor(context, acceptSamples);
  }

  source.connect(captureNode);
  captureNode.connect(silentGain);

  const cleanup = async () => {
    if (stopped) return;
    stopped = true;
    source.disconnect();
    captureNode.disconnect();
    silentGain.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    if (workletUrl) URL.revokeObjectURL(workletUrl);
    await context.close().catch(() => undefined);
    onLevel?.(0);
  };

  return {
    getDurationSeconds: () => sampleCount / context.sampleRate,
    async stop() {
      const durationSeconds = sampleCount / context.sampleRate;
      await cleanup();
      return {
        blob: await encodeMp3(chunks, context.sampleRate),
        durationSeconds,
      };
    },
    cancel: cleanup,
  };
}

function startNativeMediaRecorder(
  stream: MediaStream,
  context: AudioContext,
  onLevel?: (level: number) => void,
): ActiveMp3Recorder {
  const mimeType = resolveNativeRecorderMimeType();
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  const silentGain = context.createGain();
  const levelSamples = new Float32Array(analyser.fftSize);
  silentGain.gain.value = 0;
  source.connect(analyser);
  analyser.connect(silentGain);
  silentGain.connect(context.destination);

  let cleanedUp = false;
  let startedAt = performance.now();
  let stoppedAt: number | undefined;
  let resolveStopped!: (blob: Blob) => void;
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<Blob>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onerror = (event) => {
    const recorderError = (event as Event & { error?: Error }).error;
    rejectStopped(recorderError ?? new Error("浏览器原生录音失败。"));
  };
  recorder.onstop = () => {
    resolveStopped(
      new Blob(chunks, {
        type: recorder.mimeType || mimeType || chunks[0]?.type,
      }),
    );
  };

  const levelTimer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(levelSamples);
    let sum = 0;
    for (let index = 0; index < levelSamples.length; index += 1) {
      const sample = levelSamples[index] ?? 0;
      sum += sample * sample;
    }
    onLevel?.(
      Math.min(1, Math.sqrt(sum / Math.max(1, levelSamples.length)) * 4.5),
    );
  }, 50);

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    window.clearInterval(levelTimer);
    source.disconnect();
    analyser.disconnect();
    silentGain.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => undefined);
    onLevel?.(0);
  };

  recorder.start(250);
  startedAt = performance.now();

  return {
    getDurationSeconds: () =>
      ((stoppedAt ?? performance.now()) - startedAt) / 1_000,
    async stop() {
      stoppedAt = performance.now();
      recorder.stop();
      try {
        const nativeBlob = await stopped;
        if (!nativeBlob.size) throw new Error("浏览器没有生成录音数据。");
        const audioBuffer = await context.decodeAudioData(
          await nativeBlob.arrayBuffer(),
        );
        const samples = downmixAudioBuffer(audioBuffer);
        return {
          blob: await encodeMp3([samples], audioBuffer.sampleRate),
          durationSeconds: audioBuffer.duration,
        };
      } finally {
        await cleanup();
      }
    },
    async cancel() {
      stoppedAt = performance.now();
      if (recorder.state !== "inactive") recorder.stop();
      await stopped.catch(() => undefined);
      await cleanup();
    },
  };
}

function resolveNativeRecorderMimeType() {
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ].find((value) => MediaRecorder.isTypeSupported(value));
}

function downmixAudioBuffer(buffer: AudioBuffer) {
  const output = new Float32Array(buffer.length);
  for (
    let channelIndex = 0;
    channelIndex < buffer.numberOfChannels;
    channelIndex += 1
  ) {
    const channel = buffer.getChannelData(channelIndex);
    for (let index = 0; index < output.length; index += 1)
      output[index] += (channel[index] ?? 0) / buffer.numberOfChannels;
  }
  return output;
}

/**
 * A requested mono track is only an ideal constraint and Chromium may still
 * expose a multi-channel microphone. Capture every channel instead of silently
 * discarding all but channel zero (some microphone arrays carry speech on a
 * different channel).
 */
export function createPcmCaptureWorkletSource() {
  return `class EchooPcmCapture extends AudioWorkletProcessor {
    process(inputs) {
      const channels = inputs[0];
      const firstChannel = channels && channels[0];
      if (!firstChannel) return true;

      const mono = new Float32Array(firstChannel.length);
      for (const channel of channels) {
        const frameCount = Math.min(mono.length, channel.length);
        for (let index = 0; index < frameCount; index += 1) {
          mono[index] += channel[index] / channels.length;
        }
      }
      this.port.postMessage(mono, [mono.buffer]);
      return true;
    }
  }
  registerProcessor("echoo-pcm-capture", EchooPcmCapture);`;
}

export async function encodeMp3(
  chunks: Float32Array[],
  inputSampleRate: number,
): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const input = concatenateSamples(chunks);
  const resampled = resampleLinear(input, inputSampleRate, OUTPUT_SAMPLE_RATE);
  const pcm = floatToPcm16(resampled);
  const encoder = new Mp3Encoder(1, OUTPUT_SAMPLE_RATE, OUTPUT_BITRATE_KBPS);
  const output: BlobPart[] = [];
  for (let offset = 0; offset < pcm.length; offset += MP3_BLOCK_SIZE) {
    const encoded = encoder.encodeBuffer(
      pcm.subarray(offset, offset + MP3_BLOCK_SIZE),
    );
    if (encoded.length) output.push(new Uint8Array(encoded));
  }
  const tail = encoder.flush();
  if (tail.length) output.push(new Uint8Array(tail));
  return new Blob(output, { type: "audio/mpeg" });
}

function createScriptProcessor(
  context: AudioContext,
  onSamples: (samples: Float32Array) => void,
) {
  const processor = context.createScriptProcessor(4_096, 1, 1);
  processor.onaudioprocess = (event) =>
    onSamples(event.inputBuffer.getChannelData(0));
  return processor;
}

function concatenateSamples(chunks: Float32Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function resampleLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
) {
  if (inputRate === outputRate) return input;
  const outputLength = Math.max(
    1,
    Math.round((input.length * outputRate) / inputRate),
  );
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const mix = position - leftIndex;
    output[index] =
      (input[leftIndex] ?? 0) * (1 - mix) + (input[rightIndex] ?? 0) * mix;
  }
  return output;
}

function floatToPcm16(input: Float32Array) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}
