/**
 * 목소리 녹음.
 *
 * getUserMedia → MediaStreamSource → AudioWorklet → Float32 청크 수집.
 * MediaRecorder는 쓰지 않는다(코덱 불일치로 기기 간 교차 재생이 깨진다).
 * AudioWorklet이 없는 구형 브라우저에서는 ScriptProcessorNode로 떨어진다 —
 * 폐기 예정 API지만 여기서는 "소리가 아예 안 나오는 것"보다 낫다.
 */

import { t } from '../i18n';
import { getAudioContext, unlockAudio } from './context';
import { RECORDER_PROCESSOR_NAME, recorderWorkletUrl } from './recorder-worklet';
import { finishRecording, MAX_RECORD_SECONDS, type EncodedSound } from './wav';

export type RecorderState = 'idle' | 'ready' | 'recording' | 'done';

export type RecorderEvents = {
  /** 0~1 입력 레벨. 마이크가 살아있다는 걸 아이에게 보여주는 용도. */
  onLevel?: (level: number) => void;
  /** 1.5초에 도달해 자동으로 멈췄을 때. */
  onAutoStop?: () => void;
};

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private silentSink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private collected = 0;
  private state: RecorderState = 'idle';
  private workletReady = false;

  constructor(private events: RecorderEvents = {}) {}

  get currentState(): RecorderState {
    return this.state;
  }

  private get ctx(): AudioContext {
    return getAudioContext();
  }

  /**
   * 마이크 권한 요청.
   * 반드시 그림 단계 **이후에** 부른다 — 첫 화면에서 권한 팝업을 만나면 이탈한다.
   */
  async prepare(): Promise<void> {
    await unlockAudio();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(t('engine.cannotRecord'));
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const ctx = this.ctx;
    this.source = ctx.createMediaStreamSource(this.stream);

    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        if (!this.workletReady) {
          await ctx.audioWorklet.addModule(recorderWorkletUrl());
          this.workletReady = true;
        }
        const node = new AudioWorkletNode(ctx, RECORDER_PROCESSOR_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
        });
        node.port.onmessage = (e: MessageEvent<Float32Array>) => this.collect(e.data);
        this.node = node;
      } catch (e) {
        console.warn('[recorder] AudioWorklet 사용 불가, 폴백으로 전환합니다', e);
      }
    }

    if (!this.node) {
      // 폴백: ScriptProcessor는 출력이 어딘가에 연결돼 있어야 process가 돈다.
      const sp = ctx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (e) => this.collect(new Float32Array(e.inputBuffer.getChannelData(0)));
      this.silentSink = ctx.createGain();
      this.silentSink.gain.value = 0;
      sp.connect(this.silentSink).connect(ctx.destination);
      this.node = sp;
    }

    this.source.connect(this.node as AudioNode);
    this.state = 'ready';
  }

  private collect(chunk: Float32Array): void {
    if (this.state !== 'recording') {
      // 녹음 전에도 레벨 미터는 살아있게 둔다.
      this.events.onLevel?.(levelOf(chunk));
      return;
    }
    const limit = Math.floor(this.ctx.sampleRate * MAX_RECORD_SECONDS);
    if (this.collected >= limit) return;

    const room = limit - this.collected;
    const piece = chunk.length > room ? chunk.slice(0, room) : chunk;
    this.chunks.push(piece);
    this.collected += piece.length;
    this.events.onLevel?.(levelOf(piece));

    if (this.collected >= limit) {
      this.state = 'done';
      this.events.onAutoStop?.();
    }
  }

  /** 카운트다운이 끝난 순간 호출. */
  begin(): void {
    this.chunks = [];
    this.collected = 0;
    this.state = 'recording';
  }

  /** 수동 종료. 자동 종료된 뒤에 불려도 안전하다. */
  end(): EncodedSound {
    this.state = 'done';
    return finishRecording(this.chunks, this.ctx.sampleRate);
  }

  hasAudio(): boolean {
    return this.collected > 0;
  }

  /** 마이크 LED를 꺼 준다. 아이 기기에서 이건 신뢰 문제다. */
  dispose(): void {
    if (this.node && 'port' in this.node) {
      try {
        (this.node as AudioWorkletNode).port.postMessage('stop');
      } catch {
        /* 무시 */
      }
    }
    if (this.node && 'onaudioprocess' in this.node) {
      (this.node as ScriptProcessorNode).onaudioprocess = null;
    }
    this.source?.disconnect();
    this.node?.disconnect();
    this.silentSink?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.node = null;
    this.silentSink = null;
    this.chunks = [];
    this.collected = 0;
    this.state = 'idle';
  }
}

function levelOf(chunk: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  return Math.min(1, Math.sqrt(sum / Math.max(1, chunk.length)) * 4);
}
