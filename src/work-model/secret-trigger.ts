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

import type { KeyIndex, Secret } from './types';

export class SecretTracker {
  /** 키별 누름 횟수. */
  private counts = [0, 0, 0, 0];
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
    this.found.clear();
  }

  /**
   * 이 키를 한 번 눌렀다. 이번 누름으로 열린 비밀을 돌려준다(없으면 빈 배열).
   *
   * 조건은 **정확히 N번째**다(`=== count`). `>=`로 하면 그 뒤로 누를 때마다 다시
   * 터져서 "숨겨진 것을 찾아냈다"가 그냥 배경 효과로 바뀐다.
   */
  press(key: KeyIndex): Secret[] {
    const count = (this.counts[key] ?? 0) + 1;
    this.counts[key] = count;

    const opened: Secret[] = [];
    for (const secret of this.secrets) {
      if (this.found.has(secret.id)) continue;
      if (secret.trigger.key !== key || secret.trigger.count !== count) continue;
      this.found.add(secret.id);
      opened.push(secret);
    }
    return opened;
  }

  /** 지금까지 찾아낸 비밀 개수. */
  get foundCount(): number {
    return this.found.size;
  }

  hasFound(id: string): boolean {
    return this.found.has(id);
  }
}
