import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../state';

type IconName = 'home' | 'feed' | 'create';

function NavIcon({ name }: { name: IconName }) {
  if (name === 'home') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 10.5 12 3.7l8.5 6.8v9.2h-5.3v-5.6H8.8v5.6H3.5z" />
      </svg>
    );
  }
  if (name === 'feed') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4.8L12 21.3 9.8 19H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 4.2v2h10v-2H7Zm0 4.4v2h7v-2H7Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.8 3h2.4v7.8H21v2.4h-7.8V21h-2.4v-7.8H3v-2.4h7.8z" />
    </svg>
  );
}

export function BottomNav() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { engine, startNewDraft } = useAppState();
  const homeActive = pathname === '/' || pathname === '/profile' || pathname === '/guide';

  const create = async () => {
    void engine.unlock();
    await startNewDraft();
    nav('/create');
  };

  return (
    <nav className="bottom-nav" aria-label="주요 메뉴">
      <button
        type="button"
        className={`bottom-nav-item${homeActive ? ' active' : ''}`}
        aria-current={homeActive ? 'page' : undefined}
        onClick={() => nav('/')}
      >
        <NavIcon name="home" />
        <span>홈</span>
      </button>
      <button
        type="button"
        className={`bottom-nav-item${pathname === '/feed' ? ' active' : ''}`}
        aria-current={pathname === '/feed' ? 'page' : undefined}
        onClick={() => nav('/feed')}
      >
        <NavIcon name="feed" />
        <span>스테이지</span>
      </button>
      <button type="button" className="bottom-nav-item create" onClick={create}>
        <span className="bottom-nav-create-icon"><NavIcon name="create" /></span>
        <span>만들기</span>
      </button>
    </nav>
  );
}
