import { useNavigate } from 'react-router-dom';
import { t } from '../../i18n';
import { useAppState } from '../state';

const GUIDE_STEPS = [
  {
    icon: '✦',
    title: t('guide.step1.title'),
    body: t('guide.step1.body'),
    tip: t('guide.step1.tip'),
  },
  {
    icon: '⌨',
    title: t('guide.step2.title'),
    body: t('guide.step2.body'),
    tip: t('guide.step2.tip'),
  },
  {
    icon: '●',
    title: t('guide.step3.title'),
    body: t('guide.step3.body'),
    tip: t('guide.step3.tip'),
  },
  {
    icon: '✓',
    title: t('guide.step4.title'),
    body: t('guide.step4.body'),
    tip: t('guide.step4.tip'),
  },
  {
    icon: '▶',
    title: t('guide.step5.title'),
    body: t('guide.step5.body'),
    tip: t('guide.step5.tip'),
  },
] as const;

export function GuideScreen() {
  const nav = useNavigate();
  const { engine, startNewDraft } = useAppState();

  const create = async () => {
    void engine.unlock();
    await startNewDraft();
    nav('/create');
  };

  return (
    <main className="screen guide-screen">
      <header className="bar guide-bar">
        <button type="button" className="bar-back" onClick={() => nav('/')}>
          ‹ {t('common.home')}
        </button>
      </header>

      <section className="guide-hero">
        <p className="feed-kicker">HOW TO PLAY</p>
        <h1>{t('guide.title')}</h1>
        <p>{t('guide.lead')}</p>
      </section>

      <ol className="guide-steps">
        {GUIDE_STEPS.map((step, index) => (
          <li className="guide-step" key={step.title}>
            <div className="guide-step-number" aria-hidden="true">
              <span>{index + 1}</span>
              <b>{step.icon}</b>
            </div>
            <div className="guide-step-copy">
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              <small>{step.tip}</small>
            </div>
          </li>
        ))}
      </ol>

      <section className="guide-account">
        <span aria-hidden="true">☁</span>
        <div>
          <h2>{t('guide.accountTitle')}</h2>
          <p>{t('guide.accountBody')}</p>
        </div>
      </section>

      <button type="button" className="big-cta guide-create" onClick={create}>
        <span className="big-cta-plus">＋</span>
        {t('guide.firstWork')}
      </button>
    </main>
  );
}
