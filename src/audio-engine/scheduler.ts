/**
 * lookahead 스케줄러.
 *
 * setInterval로 "박자를 돌리면" 반드시 밀린다 — 타이머 해상도는 4ms가 아니라
 * 수십 ms이고, 탭이 백그라운드로 가면 1초로 떨어진다.
 * 대신 25ms마다 깨어나 **오디오 시계 기준 0.1초 앞**의 노트를 예약한다.
 * 노트 시각은 startTime + t/1000으로 **절대 계산**한다(누적 덧셈 금지 — 그게 드리프트다).
 *
 * v2에서 바뀐 것: 스케줄러는 이제 박자를 세지 않는다.
 * 어떤 노트가 언제 울리는지는 work-model/replay.ts가 순수 함수로 계산하고,
 * 스케줄러는 그 목록을 시간에 맞춰 흘려보내기만 한다.
 * 라이브 중 루프 토글이 들어오면 목록을 다시 계산해 갈아끼운다.
 *
 * 이 파일은 AudioContext를 직접 참조하지 않는다. 시계와 타이머를 주입받으므로
 * 가짜 시계로 2분치를 즉시 돌려 드리프트를 테스트할 수 있다.
 */

import type { Note } from '../work-model/replay';
import type { KeyIndex } from '../work-model/types';

export const LOOKAHEAD_MS = 25;
export const SCHEDULE_AHEAD_S = 0.1;

export type FireEvent = {
  key: KeyIndex;
  /** 오디오 시계 기준 절대 시각(초) */
  time: number;
  source: 'tap' | 'loop';
  /** 난수 유도용 — 시각 효과가 이 값으로 결정론적 난수를 뽑는다 */
  eventIndex: number;
};

export type SchedulerOptions = {
  /** 오디오 시계(초). 엔진이 ctx.currentTime을 넘긴다. */
  now: () => number;
  onFire: (e: FireEvent) => void;
  lookaheadMs?: number;
  scheduleAheadS?: number;
  setIntervalFn?: (fn: () => void, ms: number) => number;
  clearIntervalFn?: (id: number) => void;
};

export type StartParams = {
  /** 오디오 시계 기준 공연 시작 시각(초). */
  startTime: number;
  /** 시간순 정렬된 노트 목록. */
  notes: Note[];
  /** 공연 길이(ms). Infinity면 끝나지 않는다(자유 연주). */
  durationMs: number;
};

export class NoteScheduler {
  private opts: Required<Omit<SchedulerOptions, 'now' | 'onFire'>> &
    Pick<SchedulerOptions, 'now' | 'onFire'>;
  private timerId: number | null = null;
  private startTime = 0;
  private notes: Note[] = [];
  private cursor = 0;
  private endTime = Infinity;
  private running = false;

  constructor(options: SchedulerOptions) {
    this.opts = {
      lookaheadMs: LOOKAHEAD_MS,
      scheduleAheadS: SCHEDULE_AHEAD_S,
      setIntervalFn: (fn, ms) => setInterval(fn, ms) as unknown as number,
      clearIntervalFn: (id) => clearInterval(id),
      ...options,
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** 공연 시작 시각(오디오 시계, 초). 이벤트 기록의 기준점. */
  get performanceStart(): number {
    return this.startTime;
  }

  /** 공연 시작 기준 경과 ms. 이벤트 t는 항상 이 값으로만 만든다. */
  elapsedMs(): number {
    return Math.round((this.opts.now() - this.startTime) * 1000);
  }

  start(params: StartParams): void {
    this.stop();
    this.startTime = params.startTime;
    this.notes = params.notes;
    this.cursor = 0;
    this.endTime = Number.isFinite(params.durationMs)
      ? this.startTime + params.durationMs / 1000
      : Infinity;
    this.running = true;

    // 첫 틱은 즉시 — 25ms를 기다리면 시작 직후의 노트가 늦게 예약될 수 있다.
    this.tick();
    this.timerId = this.opts.setIntervalFn(() => this.tick(), this.opts.lookaheadMs);
  }

  /**
   * 라이브 중 루프가 켜지거나 꺼지면 노트 목록이 달라진다.
   * **이미 예약을 흘려보낸 지점(cursor) 이전은 건드리지 않는다** — 그 소리는 이미 났다.
   */
  replaceNotes(notes: Note[]): void {
    const horizonMs = (this.opts.now() + this.opts.scheduleAheadS - this.startTime) * 1000;
    this.notes = notes;
    // 지평선 안쪽(이미 예약됨)은 건너뛰고 그 뒤부터 다시 흘려보낸다.
    let i = 0;
    while (i < notes.length && notes[i].t < horizonMs) i++;
    this.cursor = i;
  }

  stop(): void {
    if (this.timerId !== null) {
      this.opts.clearIntervalFn(this.timerId);
      this.timerId = null;
    }
    this.running = false;
  }

  /** 테스트에서 직접 부를 수 있도록 공개. */
  tick(): void {
    if (!this.running) return;
    const horizon = this.opts.now() + this.opts.scheduleAheadS;

    while (this.cursor < this.notes.length) {
      const note = this.notes[this.cursor];
      const time = this.startTime + note.t / 1000;
      if (time >= horizon) break;
      this.cursor++;
      if (time >= this.endTime) continue;
      this.opts.onFire({
        key: note.key,
        time,
        source: note.source,
        eventIndex: note.eventIndex,
      });
    }
  }

  isFinished(): boolean {
    return this.opts.now() >= this.endTime;
  }
}
