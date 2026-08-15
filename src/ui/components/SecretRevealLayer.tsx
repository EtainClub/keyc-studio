/**
 * 비밀이 열리는 순간의 연출.
 *
 * 흔적 레이어와 달리 여기는 React 상태를 쓴다. 비밀은 한 세션에 많아야 세 번
 * 열리고, 그림 결과는 자산 URL을 비동기로 풀어야 해서 리렌더가 필요하다.
 * 발자국처럼 초당 여러 번 쏟아지는 것이 아니라 setState 비용이 문제되지 않는다.
 *
 * 무대(만든 아이가 시험해 보는 곳)와 감상(감상자가 찾아내는 곳)이 같은 것을 쓴다 —
 * 시험할 때와 실제로 열릴 때가 다르게 보이면 시험이 시험이 아니다.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { KeycapEngine } from '../../audio-engine/engine';
import { t } from '../../i18n';
import { resolveImageUrl } from '../../storage/assets';
import type { Secret } from '../../work-model/types';
import { useAssetUrl } from '../hooks';

/** 연출이 화면에 머무는 시간(ms). CSS의 secret-reveal 길이와 같아야 한다. */
const REVEAL_MS = 2400;

export type SecretRevealHandle = {
  reveal: (secret: Secret) => void;
  clear: () => void;
};

type Props = {
  /**
   * 이 화면에서 열릴 수 있는 비밀. 그림 URL을 **미리 풀어 두기 위한** 것이다.
   *
   * useAssetUrl은 비동기라, 비밀이 열리는 순간에 처음 해석하면 원격 자산일 때
   * 그림이 2.4초 안에 못 붙는다. 그러면 빛만 터지고 정작 숨겨 둔 그림은 안 보인다 —
   * 비밀 소리를 setSecrets에서 미리 받아 두는 것과 같은 이유다.
   */
  secrets?: readonly Secret[];
};

export const SecretRevealLayer = forwardRef<SecretRevealHandle, Props>(
  function SecretRevealLayer({ secrets }, ref) {
    const [shown, setShown] = useState<Secret | null>(null);
    /** 연출마다 새 값. 같은 비밀이 다시 열려도 애니메이션이 처음부터 돈다. */
    const [nonce, setNonce] = useState(0);
    const timer = useRef<number | null>(null);

    const artUrl = useAssetUrl(shown?.reveal.kind === 'art' ? (shown.reveal.assetId ?? null) : null);

    const clear = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setShown(null);
    };

    // 화면을 떠날 때 타이머가 살아 있으면 사라진 컴포넌트에 setState한다.
    useEffect(() => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    }, []);

    /*
     * 그림 URL 데우기. resolveImageUrl은 결과를 캐시하므로, 한 번 불러 두면
     * 정작 비밀이 열릴 때의 useAssetUrl은 한 프레임 안에 값을 내놓는다.
     * 실패는 삼킨다 — 미리 받기가 안 됐다고 화면에 뭘 띄울 일은 아니다.
     */
    useEffect(() => {
      for (const s of secrets ?? []) {
        if (s.reveal.kind === 'art' && s.reveal.assetId) {
          void resolveImageUrl(s.reveal.assetId).catch(() => {});
        }
      }
    }, [secrets]);

    useImperativeHandle(ref, () => ({
      reveal(secret) {
        if (timer.current !== null) clearTimeout(timer.current);
        setShown(secret);
        setNonce((n) => n + 1);
        timer.current = setTimeout(() => {
          timer.current = null;
          setShown(null);
        }, REVEAL_MS) as unknown as number;
      },
      clear,
    }));

    if (!shown) return null;

    return (
      <div className="secret-reveal-layer" key={nonce} aria-live="polite">
        {/* 어떤 결과든 빛은 터진다. "찾았다"는 신호가 결과 종류보다 먼저 와야 한다. */}
        <span className="secret-burst" aria-hidden />
        {/*
          * 그림과 문구를 한 덩어리로 묶어 화면 한가운데에 세운다. 각각을 화면
          * 가장자리 기준으로 놓으면 화면마다 다른 버튼 위에 얹힌다.
          */}
        <div className="secret-reveal-body">
          {shown.reveal.kind === 'art' && artUrl && (
            <img className="secret-art" src={artUrl} alt="" draggable={false} />
          )}
          <p className="secret-found">{t('secret.found')}</p>
        </div>
      </div>
    );
  },
);

/**
 * 비밀 발동 한 줄 배선.
 *
 * 소리는 엔진이, 화면은 레이어가 맡는다. 두 화면(무대·감상)이 각자 배선하면
 * 한쪽만 고쳐져 "무대에서는 소리가 나는데 감상에서는 안 나는" 상태가 된다.
 */
export function secretHandlerFor(
  engine: KeycapEngine,
  layer: { current: SecretRevealHandle | null },
): (secret: Secret) => void {
  return (secret) => {
    if (secret.reveal.kind === 'sound' && secret.reveal.assetId) {
      engine.revealSound(secret.reveal.assetId);
    }
    layer.current?.reveal(secret);
  };
}
