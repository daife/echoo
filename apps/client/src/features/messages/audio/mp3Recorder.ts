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

export async function startMp3Recorder(
  onLevel?: (level: number) => void,
): Promise<ActiveMp3Recorder> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("当前环境不支持麦克风录音。");

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("当前环境不支持音频采集。");
  }

  const context = new AudioContextClass();
  await context.resume();
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
      new Blob(
        [
          `class EchooPcmCapture extends AudioWorkletProcessor {
            process(inputs) {
              const channel = inputs[0] && inputs[0][0];
              if (channel) this.port.postMessage(channel.slice());
              return true;
            }
          }
          registerProcessor("echoo-pcm-capture", EchooPcmCapture);`,
        ],
        { type: "text/javascript" },
      ),
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
