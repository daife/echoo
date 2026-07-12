/** Estimates playable duration from complete MP3 frames in a partial or final stream. */
export function estimateMp3DurationSeconds(bytes: Uint8Array) {
  let offset = readId3Size(bytes);
  let duration = 0;

  while (offset + 4 <= bytes.length) {
    const first = bytes[offset] as number;
    const second = bytes[offset + 1] as number;
    if (first !== 0xff || (second & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }

    const versionBits = (second >> 3) & 0x03;
    const layerBits = (second >> 1) & 0x03;
    const third = bytes[offset + 2] as number;
    const bitrateIndex = (third >> 4) & 0x0f;
    const sampleRateIndex = (third >> 2) & 0x03;
    if (
      versionBits === 1 ||
      layerBits !== 1 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      sampleRateIndex === 3
    ) {
      offset += 1;
      continue;
    }

    const isMpeg1 = versionBits === 3;
    const bitrate = (isMpeg1 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES)[
      bitrateIndex - 1
    ];
    const baseSampleRate = SAMPLE_RATES[sampleRateIndex];
    if (!bitrate || !baseSampleRate) {
      offset += 1;
      continue;
    }
    const sampleRate =
      versionBits === 3
        ? baseSampleRate
        : versionBits === 2
          ? baseSampleRate / 2
          : baseSampleRate / 4;
    const padding = (third >> 1) & 0x01;
    const frameLength = Math.floor(
      ((isMpeg1 ? 144_000 : 72_000) * bitrate) / sampleRate + padding,
    );
    if (frameLength <= 4 || offset + frameLength > bytes.length) break;

    duration += (isMpeg1 ? 1152 : 576) / sampleRate;
    offset += frameLength;
  }

  return duration;
}

const MPEG1_LAYER3_BITRATES = [
  32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const MPEG2_LAYER3_BITRATES = [
  8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
];
const SAMPLE_RATES = [44_100, 48_000, 32_000];

function readId3Size(bytes: Uint8Array) {
  if (
    bytes.length < 10 ||
    bytes[0] !== 0x49 ||
    bytes[1] !== 0x44 ||
    bytes[2] !== 0x33
  )
    return 0;
  return (
    10 +
    (((bytes[6] as number) & 0x7f) << 21) +
    (((bytes[7] as number) & 0x7f) << 14) +
    (((bytes[8] as number) & 0x7f) << 7) +
    ((bytes[9] as number) & 0x7f)
  );
}
