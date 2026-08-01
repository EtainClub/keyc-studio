import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { AppStateProvider } from './state';
import { HomeScreen } from './screens/HomeScreen';
import { ViewScreen } from './screens/ViewScreen';

/**
 * 만들기 쪽 화면은 지연 로딩한다.
 * 링크로 들어온 감상자(대부분의 방문)는 그리기 캔버스와 녹음기를 받을 이유가 없다.
 */
const CreateScreen = lazy(() =>
  import('./screens/CreateScreen').then((m) => ({ default: m.CreateScreen })),
);
const StageScreen = lazy(() =>
  import('./screens/StageScreen').then((m) => ({ default: m.StageScreen })),
);
const PerformScreen = lazy(() =>
  import('./screens/PerformScreen').then((m) => ({ default: m.PerformScreen })),
);
const WorkCardScreen = lazy(() =>
  import('./screens/WorkCardScreen').then((m) => ({ default: m.WorkCardScreen })),
);
const FeedScreen = lazy(() =>
  import('./screens/FeedScreen').then((m) => ({ default: m.FeedScreen })),
);
const ProfileScreen = lazy(() =>
  import('./screens/ProfileScreen').then((m) => ({ default: m.ProfileScreen })),
);
const GuideScreen = lazy(() =>
  import('./screens/GuideScreen').then((m) => ({ default: m.GuideScreen })),
);

function AppRoutes() {
  const { pathname } = useLocation();
  const showBottomNav =
    pathname === '/' || pathname === '/feed' || pathname === '/profile' || pathname === '/guide' || pathname.startsWith('/w/');

  return (
    <div className={`app-shell${showBottomNav ? ' with-bottom-nav' : ''}`}>
      <Suspense fallback={<main className="screen"><p className="note">준비 중…</p></main>}>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/feed" element={<FeedScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/guide" element={<GuideScreen />} />
          <Route path="/create" element={<CreateScreen />} />
          <Route path="/stage" element={<StageScreen />} />
          <Route path="/perform" element={<PerformScreen />} />
          <Route path="/card" element={<WorkCardScreen />} />
          <Route path="/w/:id" element={<ViewScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      {showBottomNav ? <BottomNav /> : null}
    </div>
  );
}

export function App() {
  return (
    <AppStateProvider>
      <AppRoutes />
    </AppStateProvider>
  );
}
