import { describe, expect, it } from 'vitest';
import { createWork } from '../work-model/defaults';
import { applyDraftChange, isShareCurrent } from './draft-state';

describe('공유된 작품 다시 편집', () => {
  it('내용을 바꾸면 로컬 초안으로 되돌려 재공유를 요구한다', () => {
    const published = { ...createWork({ authorNick: '테스터' }), visibility: 'link' as const };

    const changed = applyDraftChange(published, { title: '새 제목' });

    expect(changed.visibility).toBe('local');
    expect(isShareCurrent(changed, true)).toBe(false);
  });

  it('공유 완료 결과를 반영할 때는 공유 상태를 유지한다', () => {
    const draft = createWork({ authorNick: '테스터' });

    const published = applyDraftChange(draft, { visibility: 'link' });

    expect(published.visibility).toBe('link');
    expect(isShareCurrent(published, true)).toBe(true);
  });
});
