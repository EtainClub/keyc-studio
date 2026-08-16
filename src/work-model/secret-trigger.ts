/**
 * 비밀이 언제 열리는가.
 *
 * 오디오도 화면도 모르는 순수 상태 기계다. 엔진이 누를 때마다 키를 넣어 주고,
 * 이번 누름으로 열린 비밀만 돌려받는다.
 *
 * 엔진 안에 두지 않고 떼어낸 이유: 이 판정은 **조용히 틀린다.** 한 번 더 터지거나,
 * 세션이 바뀌었는데 진행 상태가 남아 첫 누름에 열리거나, 영영 안 열리거나 —
 * 셋 다 화면을 보고는 알아채기 어렵다. 떼어 두면 시험할 수 있다.
 */

import { SECRET_SEQUENCE_MAX, type KeyIndex, type Secret } from './types';

export class SecretTracker {
  /** 키별 누름 횟수. pressCount 조건이 본다. */
  private counts = [0, 0, 0, 0];
  /**
   * 최근에 누른 키들. sequence 조건이 본다.
   *
   * 진행 인덱스를 세지 않고 **최근 누름을 그대로 들고 있는** 이유가 있다.
   * "지금 몇 번째까지 맞췄나"를 세는 방식은 같은 키가 반복되는 순서에서 조용히
   * 틀린다 — 예를 들어 조건이 [탄지로, 탄지로, 네즈코]인데 탄지로를 세 번 누르고
   * 네즈코를 누르면, 진행 인덱스는 세 번째 탄지로에서 어긋났다고 보고 처음으로
   * 되돌아가 버린다. 실제로는 열려야 하는 순서인데도.
   *
   * 최근 N개를 조건과 통째로 맞대면 그 실수가 아예 불가능하다. N이 6 이하라
   * 비용도 없다.
   */
  private recent: KeyIndex[] = [];
  /** 이미 열린 비밀. 같은 비밀이 두 번 터지면 발견의 순간이 값싸진다. */
  private found = new Set<string>();
  private secrets: readonly Secret[] = [];

  constructor(secrets: readonly Secret[] = []) {
    this.reset(secrets);
  }

  /** 비밀 목록을 갈아끼우고 진행 상태를 처음으로 되돌린다. */
  reset(secrets: readonly Secret[] = []): void {
    this.secrets = secrets;
    this.counts = [0, 0, 0, 0];
    this.recent = [];
    this.found.clear();
  }

  /**
   * 이 키를 한 번 눌렀다. 이번 누름으로 열린 비밀을 돌려준다(없으면 빈 배열).
   *
   * 두 조건이 한 누름에 함께 열릴 수 있다. 그건 아이가 그렇게 만든 것이므로
   * 막지 않는다 — 돌려주는 배열이 여럿인 이유다.
   */
  press(key: KeyIndex): Secret[] {
    const count = (this.counts[key] ?? 0) + 1;
    this.counts[key] = count;

    this.recent.push(key);
    // 가장 긴 순서 조건보다 더 들고 있을 이유가 없다.
    if (this.recent.length > SECRET_SEQUENCE_MAX) this.recent.shift();

    const opened: Secret[] = [];
    for (const secret of this.secrets) {
      if (this.found.has(secret.id)) continue;
      if (!this.matches(secret, key, count)) continue;
      this.found.add(secret.id);
      opened.push(secret);
    }
    return opened;
  }

  private matches(secret: Secret, key: KeyIndex, count: number): boolean {
    const trigger = secret.trigger;

    if (trigger.kind === 'pressCount') {
      /*
       * **정확히 N번째**다(`=== count`). `>=`로 하면 그 뒤로 누를 때마다 다시
       * 터져서 "숨겨진 것을 찾아냈다"가 그냥 배경 효과로 바뀐다.
       */
      return trigger.key === key && trigger.count === count;
    }

    // 빈 순서는 아무 누름에나 맞아 버린다. 첫 누름에 열리는 비밀은 비밀이 아니다.
    const want = trigger.keys;
    if (want.length === 0 || want.length > this.recent.length) return false;

    const from = this.recent.length - want.length;
    return want.every((k, i) => this.recent[from + i] === k);
  }

  /** 지금까지 찾아낸 비밀 개수. */
  get foundCount(): number {
    return this.found.size;
  }

  hasFound(id: string): boolean {
    return this.found.has(id);
  }
}
