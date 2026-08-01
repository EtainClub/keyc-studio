import { useNavigate } from 'react-router-dom';
import { useAppState } from '../state';

const GUIDE_STEPS = [
  {
    icon: '✦',
    title: '키캡 네 개 꾸미기',
    body: '새로 만들기를 누르고 각 키캡에 색, 그림, 움직임과 소리를 담아 보세요. 내 목소리를 직접 녹음할 수도 있어요.',
    tip: '키캡을 눌러 꾸민 모양과 소리를 바로 미리 볼 수 있어요.',
  },
  {
    icon: '⌨',
    title: '무대에서 연주 확인하기',
    body: '완성한 키캡을 자유롭게 누르고 반복 재생할 키를 골라 보세요. 여기서 한 연주는 아직 공연 기록에 들어가지 않아요.',
    tip: '소리가 들리지 않으면 화면을 한 번 누른 뒤 다시 연주해 보세요.',
  },
  {
    icon: '●',
    title: '15초 공연 만들기',
    body: '공연을 시작하면 키를 누른 순간과 루프를 켜고 끈 시간이 기록돼요. 필요하면 일시정지하고 이어서 할 수 있어요.',
    tip: '중단하면 이번 공연을 버리고 준비 무대로 돌아가요.',
  },
  {
    icon: '✓',
    title: '작품 완성하고 공개하기',
    body: '마음에 들면 제목과 힌트를 적어 완성하세요. 공유할 때는 목소리 처리 방법과 공개 기간을 직접 고를 수 있어요.',
    tip: '공개하지 않은 작품과 프로필 사진은 이 기기 또는 내 계정에만 남아요.',
  },
  {
    icon: '▶',
    title: '스테이지에서 리플레이하기',
    body: '키크 스테이지에서 다른 크리에이터의 공개 공연을 감상하고 직접 키캡을 눌러 다시 연주해 보세요.',
    tip: '감상 중에도 일시정지, 계속하기와 재생 중단을 사용할 수 있어요.',
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
          ‹ 홈
        </button>
      </header>

      <section className="guide-hero">
        <p className="feed-kicker">HOW TO PLAY</p>
        <h1>키크 사용법</h1>
        <p>꾸미고, 연주하고, 15초 공연으로 남겨 보세요.</p>
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
          <h2>작품을 오래 보관하려면</h2>
          <p>프로필에서 Google 계정을 연결하세요. 계정 연결만으로 작품이 공개되지는 않아요.</p>
        </div>
      </section>

      <button type="button" className="big-cta guide-create" onClick={create}>
        <span className="big-cta-plus">＋</span>
        첫 작품 만들기
      </button>
    </main>
  );
}
