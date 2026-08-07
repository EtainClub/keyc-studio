import { useEffect, useRef, useState, type RefObject } from 'react';
import { resolveImageUrl } from '../storage/assets';

/** 포커스를 받을 수 있는 것들. `disabled`와 `hidden`은 제외한다. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 모달 한 겹을 다루는 규칙 — Esc로 닫기, Tab이 밖으로 새지 않기, 닫으면 원래 자리로.
 *
 * 이걸 손으로 다시 짜면 매번 하나씩 빠진다. 실제로 이 앱은 홈의 작은 프로필
 * 드롭다운만 Esc를 처리하고, 정작 화면을 다 덮는 편집 시트와 공유 게이트는
 * 셋 다 없었다.
 *
 * `locked`는 되돌릴 수 없는 작업이 도는 중(업로드 등)을 뜻한다. 그동안에는
 * Esc를 먹지 않는다 — 중간에 닫히면 반쯤 올라간 작품이 남는다.
 */
export function useModalShell(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  locked = false,
): void {
  // 닫기 함수가 매 렌더 새로 만들어져도 리스너를 다시 달지 않게 최신 값만 들고 있는다.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const previous = document.activeElement as HTMLElement | null;
    // 열리자마자 안쪽 첫 요소로 옮긴다. 그래야 다음 Tab이 모달 안에서 시작한다.
    node.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (lockedRef.current) return;
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // 양 끝에서 순환시킨다. 이게 없으면 Tab이 뒤 화면으로 새어 나간다.
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // 닫힌 뒤 포커스가 body로 떨어지면 키보드 사용자는 처음부터 다시 Tab 해야 한다.
      previous?.focus?.();
    };
  }, [ref]);
}

/** assetId → 실제 표시 가능한 URL. 없으면 null. */
export function useAssetUrl(assetId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!assetId) {
      setUrl(null);
      return;
    }
    resolveImageUrl(assetId)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [assetId]);
  return url;
}

/** 화면이 다시 보일 때 오디오 컨텍스트를 되살린다. */
export function useResumeOnVisible(resume: () => void): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [resume]);
}
