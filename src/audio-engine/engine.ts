/**
 * 엔진 파사드 — UI가 보는 유일한 표면.
 *
 * React를 import하지 않는다. 네이티브로 갈 때 이 클래스의 **인터페이스만** 유지하고
 * 내부를 네이티브 오디오로 갈아끼우면 work-model과 화면 로직은 그대로 산다.
 *
 * ── 결정론이 지켜지는 방식 ──
 * 라이브와 리플레이가 "비슷하게" 동작하도록 두 벌의 코드를 맞추는 게 아니라,
 * **둘 다 expandReplay() 하나가 만든 노트 목록을 재생한다.**
 * 라이브 중 루프를 토글하면 이벤트를 기록하고 노트 목록을 통째로 다시 계산해
 * 스케줄러에 갈아끼운다. 그래서 라이브가 곧 리플레이다 — 맞출 필요가 없다.
 */

import { expandReplay, hashNotes, type Note } from '../work-model/replay';
import { durationForTempo } from '../work-model/timing';
import { newSeed } from '../work-model/rng';
import { playbackPresetId } from '../work-model/presets';
import type {
  KeyDef,
  KeyIndex,
  Replay,
  ReplayEvent,
  ReplayEventType,
  Tempo,
  Work,
} from '../work-model/types';
import { AnimationQueue, type VisualEvent } from './animation-queue';
import { getAudioContext, resumeIfNeeded, unlockAudio } from './context';
import { play } from './player';
import { NoteScheduler } from './scheduler';
import { assetSoundKey, SoundBank, type AssetResolver } from './sound-bank';

export type EngineMode = 'idle' | 'live' | 'replay' | 'free';

export type SessionHandlers = {
  /** 0~1 진행률과 경과 ms. */
  onProgress?: (ratio: number, elapsedMs: number) => void;
  onEnd?: () => void;
};

/** KeyDef가 실제로 어떤 소리를 쓰는지 — 프리셋이거나 내 자산이거나. */
export function soundKeyOf(key: KeyDef): string {
  return key.sound.assetId
    ? assetSoundKey(key.sound.assetId)
    : playbackPresetId(key.sound.presetId ?? 'tok@1');
}

export class KeycapEngine {
  readonly bank: SoundBank;
  private ctx: AudioContext;
  private scheduler: NoteScheduler;
  private visuals: AnimationQueue;
  private visualHandler: (e: VisualEvent) => void = () => {};

  private keys: KeyDef[] = [];
  private tempo: Tempo = { preset: 'normal', bpm: 100 };
  private seed = 0;
  private events: ReplayEvent[] = [];
  private nextEventIndex = 0;
  private mode: EngineMode = 'idle';
  private recording = false;
  private durationMs = Infinity;

  /** 라이브 중 실제로 발화한 노트. 셀프체크에서 재계산 결과와 대조한다. */
  private firedLog: Note[] = [];

  private progressRaf: number | null = null;
  private endTimer: number | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private sessionPaused = false;
  private sessionHandlers: SessionHandlers = {};

  constructor(resolver: AssetResolver) {
    this.ctx = getAudioContext();
    this.bank = new SoundBank(this.ctx, resolver);
    this.visuals = new AnimationQueue(
      () => this.ctx.currentTime,
      (e) => this.visualHandler(e),
    );
    this.scheduler = new NoteScheduler({
      now: () => this.ctx.currentTime,
      onFire: (e) => {
        const key = this.keys[e.key];
        if (!key) return;
        const buf = this.bank.get(soundKeyOf(key));
        if (buf) this.playBuffer(buf, key, e.time);
        this.visuals.push({ ...e, seed: this.seed });
        if (this.recording) {
          this.firedLog.push({
            t: Math.round((e.time - this.scheduler.performanceStart) * 1000),
            key: e.key,
            source: e.source,
            eventIndex: e.eventIndex,
          });
        }
      },
    });
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }

  get currentMode(): EngineMode {
    return this.mode;
  }

  get currentSeed(): number {
    return this.seed;
  }

  get isPaused(): boolean {
    return this.sessionPaused;
  }

  setVisualHandler(fn: (e: VisualEvent) => void): void {
    this.visualHandler = fn;
  }

  setAssetResolver(resolver: AssetResolver): void {
    this.bank.setResolver(resolver);
  }

  /** 첫 pointerdown에서 호출. */
  async unlock(): Promise<void> {
    await unlockAudio();
  }

  async resume(): Promise<void> {
    if (this.sessionPaused) return;
    await resumeIfNeeded();
  }

  /** 화면 진입 시 4개 키의 소리를 전부 디코드해 둔다. */
  async prepare(keys: readonly KeyDef[]): Promise<void> {
    this.keys = [...keys];
    await this.bank.preload(keys.map(soundKeyOf));
  }

  /* ── 즉시 발음 ─────────────────────────────────── */

  /**
   * 직접 누름. pointerdown에서 **동기적으로** 호출해야 한다.
   * await도, setState도 이 앞에 두지 말 것.
   */
  press(idx: KeyIndex): void {
    const key = this.keys[idx];
    if (!key) return;
    const buf = this.bank.get(soundKeyOf(key));
    if (buf) this.playBuffer(buf, key);

    const at = this.record('keyDown', idx);
    // 직접 누른 것은 예약이 아니라 지금이므로 큐를 거치지 않고 바로 발화한다.
    this.visualHandler({
      key: idx,
      time: this.ctx.currentTime,
      source: 'tap',
      eventIndex: at,
      seed: this.seed,
    });

    // 셀프체크가 비교할 "실제로 울린 것"에 이 탭도 포함되어야 한다.
    // 스케줄러를 거치지 않는다고 빼면, 재계산 결과와 영원히 불일치한다.
    if (this.recording && at >= 0) {
      const t = this.scheduler.elapsedMs();
      if (t >= 0 && t < this.durationMs) {
        this.firedLog.push({ t, key: idx, source: 'tap', eventIndex: at });
      }
    }
  }

  /** 손을 뗀 시각. 소리를 내지 않지만 기록은 남는다. */
  release(idx: KeyIndex): void {
    this.record('keyUp', idx);
  }

  /** 미리듣기 한 방(편집 시트에서 소리를 고를 때). */
  previewKey(key: KeyDef): void {
    const soundKey = soundKeyOf(key);
    const buf = this.bank.get(soundKey);
    if (buf) {
      this.playBuffer(buf, key);
      return;
    }
    // 선택 목록에서 처음 고른 실제 녹음은 아직 현재 작품의 preload 대상이 아닐 수 있다.
    // 편집 미리듣기만 비동기로 보완하고, 무대의 press 경로는 계속 동기 캐시만 사용한다.
    void this.bank.load(soundKey)
      .then((loaded) => this.playBuffer(loaded, key))
      .catch((cause) => console.warn('[audio] 미리듣기를 불러오지 못했어요:', soundKey, cause));
  }

  previewBuffer(key: KeyDef, buf: AudioBuffer): void {
    this.playBuffer(buf, key);
  }

  private playBuffer(buffer: AudioBuffer, key: Pick<KeyDef, 'sound'>, when?: number): void {
    const source = play(this.ctx, buffer, key, { when });
    this.activeSources.add(source);
    source.onended = () => this.activeSources.delete(source);
  }

  /* ── 루프 ──────────────────────────────────────── */

  /**
   * 루프 토글.
   * 라이브 중이면 이벤트로 기록되고, 준비 단계에서는 KeyDef를 직접 바꾼다.
   * 어느 쪽이든 노트 목록을 다시 계산해 스케줄러에 갈아끼운다.
   */
  toggleLoop(idx: KeyIndex, on: boolean): void {
    const key = this.keys[idx];
    if (!key) return;

    if (this.mode === 'live') {
      this.record(on ? 'loopOn' : 'loopOff', idx);
    } else {
      this.keys[idx] = { ...key, loop: { ...key.loop, enabled: on } };
    }
    this.rebuildNotes();
  }

  /** 이 시각 기준으로 키의 루프가 켜져 있는가(UI 표시용). */
  isLoopOn(idx: KeyIndex): boolean {
    const key = this.keys[idx];
    if (!key) return false;
    if (this.mode !== 'live') return key.loop.enabled;
    let on = key.loop.enabled;
    for (const e of this.events) {
      if (e.key !== idx) continue;
      if (e.type === 'loopOn') on = true;
      else if (e.type === 'loopOff') on = false;
    }
    return on;
  }

  private rebuildNotes(): void {
    if (!this.scheduler.isRunning) return;
    this.scheduler.replaceNotes(this.computeNotes());
  }

  private computeNotes(): Note[] {
    return expandReplay(
      this.keys,
      { seed: this.seed, durationMs: this.durationMs, events: this.events },
      this.tempo.bpm,
    );
  }

  /* ── 기록 ──────────────────────────────────────── */

  /**
   * 이벤트 기록. 시간 기준은 **오직 AudioContext**.
   * Date.now()나 performance.now()를 섞으면 오디오와 미세하게 어긋나고,
   * 그 어긋남이 리플레이마다 달라진다.
   */
  private record(type: ReplayEventType, key: KeyIndex): number {
    // -1 = 기록되지 않음. 0은 정상적인 첫 이벤트 인덱스이므로 실패값으로 쓸 수 없다.
    if (!this.recording) return -1;
    const t = this.scheduler.elapsedMs();
    if (t < 0 || t >= this.durationMs) return -1;
    const i = this.nextEventIndex++;
    this.events.push({ i, t, type, key });
    return i;
  }

  /* ── 세션 ──────────────────────────────────────── */

  /** ④ 공연: 아이가 누른 것과 루프 토글이 기록된다. */
  startLive(
    keys: readonly KeyDef[],
    tempo: Tempo,
    handlers: SessionHandlers = {},
  ): void {
    const duration = durationForTempo(tempo);
    this.beginSession('live', keys, tempo, newSeed(), [], duration);
    this.recording = true;
    this.firedLog = [];
    this.runClock(duration, handlers);
  }

  /** 감상 ①: 작품 다시 보기. 입력 차단, seed 고정. */
  playReplay(work: Work, handlers: SessionHandlers = {}): void {
    this.beginSession(
      'replay',
      work.keys,
      work.tempo,
      work.replay.seed,
      work.replay.events,
      work.replay.durationMs,
    );
    this.runClock(work.replay.durationMs, handlers);
  }

  /** 감상 ②: 직접 눌러보기. 루프 전부 off, 무제한, 새 seed. */
  startFree(work: Work): void {
    const keys = work.keys.map((k) => ({
      ...k,
      loop: { ...k.loop, enabled: false },
    })) as KeyDef[];
    this.beginSession('free', keys, work.tempo, newSeed(), [], Infinity);
  }

  private beginSession(
    mode: EngineMode,
    keys: readonly KeyDef[],
    tempo: Tempo,
    seed: number,
    events: ReplayEvent[],
    durationMs: number,
  ): void {
    this.stop();
    this.keys = [...keys];
    this.tempo = tempo;
    this.seed = seed;
    this.events = [...events];
    this.nextEventIndex = events.length ? Math.max(...events.map((e) => e.i)) + 1 : 0;
    this.durationMs = durationMs;
    this.mode = mode;
    this.sessionPaused = false;
    this.sessionHandlers = {};
    this.scheduler.start({
      startTime: this.ctx.currentTime + 0.1,
      notes: this.computeNotes(),
      durationMs,
    });
  }

  private runClock(durationMs: number, handlers: SessionHandlers): void {
    this.sessionHandlers = handlers;
    const startTime = this.scheduler.performanceStart;
    const tick = () => {
      const elapsed = (this.ctx.currentTime - startTime) * 1000;
      handlers.onProgress?.(Math.min(1, Math.max(0, elapsed / durationMs)), Math.max(0, elapsed));
      if (elapsed >= durationMs) {
        this.progressRaf = null;
        this.finish(handlers);
        return;
      }
      this.progressRaf = requestAnimationFrame(tick);
    };
    this.progressRaf = requestAnimationFrame(tick);

    // 탭이 백그라운드로 가면 rAF가 멈춘다. 타이머로 한 번 더 보험을 건다.
    const elapsed = Math.max(0, (this.ctx.currentTime - startTime) * 1000);
    const remaining = Math.max(0, durationMs - elapsed);
    this.endTimer = setTimeout(
      () => this.finish(handlers),
      remaining + 300,
    ) as unknown as number;
  }

  async pause(): Promise<boolean> {
    if (this.sessionPaused || (this.mode !== 'live' && this.mode !== 'replay')) return false;
    this.sessionPaused = true;
    this.stopTimers();
    this.visuals.pause();
    await this.ctx.suspend();
    return true;
  }

  async resumePlayback(): Promise<boolean> {
    if (!this.sessionPaused || (this.mode !== 'live' && this.mode !== 'replay')) return false;
    await this.ctx.resume();
    this.sessionPaused = false;
    this.visuals.resume();
    this.runClock(this.durationMs, this.sessionHandlers);
    return true;
  }

  private finish(handlers: SessionHandlers): void {
    if (this.mode !== 'live' && this.mode !== 'replay') return;
    this.stopTimers();
    this.scheduler.stop();
    this.visuals.clear();
    this.recording = false;
    this.sessionPaused = false;
    this.sessionHandlers = {};
    this.mode = 'idle';
    handlers.onEnd?.();
  }

  /** 공연 결과. 저장 직전에 읽는다. */
  getReplay(): Replay {
    return {
      seed: this.seed,
      durationMs: Number.isFinite(this.durationMs) ? this.durationMs : 0,
      events: [...this.events].sort((a, b) => a.t - b.t || a.i - b.i),
    };
  }

  /** 준비 단계에서 아이가 켜둔 루프 상태 — 공연의 초기 상태가 된다. */
  getKeys(): KeyDef[] {
    return [...this.keys];
  }

  /**
   * 셀프체크: 방금 공연에서 **실제로 울린 노트**와,
   * 저장될 기록으로부터 **다시 계산한 노트**가 같은가.
   *
   * 불일치는 결정론이 깨졌다는 뜻이고, 그건 사용자 신고 전에 알아야 한다.
   */
  selfCheck(): { ok: boolean; live: string; recomputed: string; count: number } {
    const live = hashNotes([...this.firedLog].sort((a, b) => a.t - b.t || a.key - b.key));
    const recomputed = hashNotes(
      expandReplay(this.keys, this.getReplay(), this.tempo.bpm)
        .filter((n) => n.t < this.durationMs)
        .sort((a, b) => a.t - b.t || a.key - b.key),
    );
    return { ok: live === recomputed, live, recomputed, count: this.firedLog.length };
  }

  private stopTimers(): void {
    if (this.progressRaf !== null) {
      cancelAnimationFrame(this.progressRaf);
      this.progressRaf = null;
    }
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
  }

  stop(): void {
    this.scheduler.stop();
    this.visuals.clear();
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // 이미 끝난 일회용 source는 중복 stop을 무시한다.
      }
    }
    this.activeSources.clear();
    this.recording = false;
    this.sessionPaused = false;
    this.sessionHandlers = {};
    this.mode = 'idle';
    this.stopTimers();
  }

  dispose(): void {
    this.stop();
    this.bank.clear();
  }
}
