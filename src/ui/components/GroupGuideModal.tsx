/**
 * 그룹 스테이지 안내 — [그룹] 탭에 들어오면 한 번 뜬다.
 *
 * 이 창이 파는 것은 기능 목록이 아니라 **쓸 자리**다. 그룹은 원래 학급·모둠을
 * 염두에 두고 만들었지만, 실제로 가장 잘 맞는 자리는 "지금 이 방에 모인 사람들이
 * 30초 안에 뭔가를 같이 만들어야 하는" 순간(워크숍 아이스브레이킹, 팀 빌딩,
 * 온보딩)이다. 그래서 첫 화면부터 그 이야기를 한다.
 *
 * 닫는 길을 셋 둔다: 배경 누르기·Esc(useModalShell), [닫기], 그리고
 * [다음에 보지 않기]. 셋째만 영구적이고, 그 뒤에도 [그룹 활용법] 버튼으로 다시 열 수 있다.
 */

import { useRef } from 'react';
import { t } from '../../i18n';
import { useModalShell } from '../hooks';

const STEPS = [
  { title: t('groupGuide.step1.title'), body: t('groupGuide.step1.body') },
  { title: t('groupGuide.step2.title'), body: t('groupGuide.step2.body') },
  { title: t('groupGuide.step3.title'), body: t('groupGuide.step3.body') },
  { title: t('groupGuide.step4.title'), body: t('groupGuide.step4.body') },
] as const;

const USES = [
  t('groupGuide.use1'),
  t('groupGuide.use2'),
  t('groupGuide.use3'),
  t('groupGuide.use4'),
] as const;

export function GroupGuideModal({
  onClose,
  onDontShowAgain,
  onCreate,
  onJoin,
}: {
  onClose: () => void;
  onDontShowAgain: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useModalShell(ref, onClose);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        ref={ref}
        className="sheet group-guide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('groupGuide.aria')}
      >
        <div className="sheet-body group-guide-body">
          <header className="group-guide-hero">
            <p className="feed-kicker">{t('groupGuide.kicker')}</p>
            <h2>{t('groupGuide.title')}</h2>
            <p>{t('groupGuide.lead')}</p>
          </header>

          <ol className="group-guide-steps">
            {STEPS.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>

          <section className="group-guide-uses">
            <h3>{t('groupGuide.useTitle')}</h3>
            <ul>
              {USES.map((use) => (
                <li key={use}>{use}</li>
              ))}
            </ul>
          </section>

          <section className="group-guide-privacy">
            <strong>{t('groupGuide.privacyTitle')}</strong>
            <p>{t('groupGuide.privacy')}</p>
          </section>
        </div>

        <div className="group-guide-actions">
          <button type="button" className="chip primary wide" onClick={onCreate}>
            {t('groupGuide.create')}
          </button>
          <button type="button" className="chip wide" onClick={onJoin}>
            {t('groupGuide.join')}
          </button>
          <div className="group-guide-dismiss">
            <button type="button" className="chip ghost" onClick={onDontShowAgain}>
              {t('groupGuide.dontShowAgain')}
            </button>
            <button type="button" className="chip ghost" onClick={onClose}>
              {t('groupGuide.close')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
