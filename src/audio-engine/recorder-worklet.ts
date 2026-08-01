/**
 * AudioWorklet 프로세서 소스.
 *
 * 문자열로 들고 Blob URL로 addModule한다 — 별도 파일을 public/에 두면
 * 번들러 설정과 배포 경로에 묶이고, 그때마다 조용히 깨진다.
 */

export const RECORDER_PROCESSOR_NAME = 'keycap-recorder';

export const RECORDER_WORKLET_SOURCE = `
class KeycapRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.active = false;
    };
  }
  process(inputs) {
    if (!this.active) return false;
    const input = inputs[0];
    if (input && input[0]) {
      // 렌더 퀀텀 버퍼는 재사용되므로 반드시 복사해서 보낸다.
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(RECORDER_PROCESSOR_NAME)}, KeycapRecorder);
`;

let moduleUrl: string | null = null;

export function recorderWorkletUrl(): string {
  if (!moduleUrl) {
    moduleUrl = URL.createObjectURL(
      new Blob([RECORDER_WORKLET_SOURCE], { type: 'application/javascript' }),
    );
  }
  return moduleUrl;
}
