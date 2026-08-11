import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
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
const JoinGroupScreen = lazy(() =>
  import('./screens/JoinGroupScreen').then((m) => ({ default: m.JoinGroupScreen })),
);

/**
 * `/g/:groupId` 딥링크(QR·초대 코드 화면 등에서 만들 수 있는 짧은 링크)를
 * `/feed?g=:groupId`로 흡수한다. 그룹 스테이지는 FeedScreen의 탭 상태로만
 * 존재해야 한다 — 별도 라우트로 화면이 두 곳에 있으면 뒤로가기·탭 상태가
 * 서로 어긋난다.
 */
function GroupDeepLink() {
  const { groupId } = useParams();
  return <Navigate to={`/feed?g=${groupId}`} replace />;
}

function AppRoutes() {
  const { pathname } = useLocation();
  const showBottomNav =
    pathname === '/' ||
    pathname === '/feed' ||
    pathname === '/profile' ||
    pathname === '/guide' ||
    pathname.startsWith('/w/') ||
    // /g/join도 포함한다 — 코드 입력이나 그룹 만들기 도중에도 홈으로 돌아갈 길이
    // 필요하다. /g/:groupId는 즉시 /feed로 리다이렉트되므로 잠깐 보였다 사라진다.
    pathname.startsWith('/g/');

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
          {/* /g/join이 /g/:groupId보다 먼저 와야 한다 — 순서로도 구체적인 경로가
           * 이기게 보장해 둔다. */}
          <Route path="/g/join" element={<JoinGroupScreen />} />
          <Route path="/g/:groupId" element={<GroupDeepLink />} />
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
