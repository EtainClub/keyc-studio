/**
 * ② 만들기.
 *
 * 키캡 4개는 이미 색·소리·움직임·느낌이 채워진 상태로 놓여 있다.
 * 아무것도 바꾸지 않고 곧장 무대로 갈 수 있어야 한다 — 빈 캔버스는 벽이다.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { findAsset, type AssetRef, type KeyIndex } from '../../work-model/types';
import { EditSheet } from '../components/EditSheet';
import { KeycapGrid, type GridHandle } from '../components/KeycapGrid';
import { useAppState } from '../state';
import { useResumeOnVisible } from '../hooks';

export function CreateScreen() {
  const nav = useNavigate();
  const { engine, draft, patchKey, patchDraft, saveDraft } = useAppState();
  const gridRef = useRef<GridHandle>(null);
  const [editing, setEditing] = useState<KeyIndex | null>(null);

  useResumeOnVisible(() => void engine.resume());

  useEffect(() => {
    if (!draft) {
      nav('/', { replace: true });
      return;
    }
    engine.setVisualHandler((e) => gridRef.current?.fire(e.key, e.source));
    void engine.prepare(draft.keys);
  }, [draft, engine, nav]);

  // 키 설정이 바뀌면 엔진이 보는 keys도 즉시 갱신한다(누르면 새 소리가 나야 한다).
  useEffect(() => {
    if (draft) void engine.prepare(draft.keys);
  }, [draft, engine]);

  if (!draft) return null;

  const addAsset = (asset: AssetRef) => {
    patchDraft({ assets: [...draft.assets, asset] });
  };

  return (
    <main className="screen create">
      <header className="bar">
        <button type="button" className="bar-back" onClick={() => nav('/')}>
          ‹ 홈
        </button>
        <h1>키캡 꾸미기</h1>
      </header>

      <p className="guide">
        키캡을 누르면 소리가 나고 꾸미기가 열려요. 그냥 무대로 가도 괜찮아요.
      </p>

      <KeycapGrid
        ref={gridRef}
        keys={draft.keys}
        onPress={(idx) => {
          void engine.unlock();
          engine.press(idx);
        }}
        onSelect={(idx) => setEditing(idx)}
      />

      <button
        type="button"
        className="big-cta bottom"
        onClick={async () => {
          await saveDraft({ thumb: true });
          nav('/stage');
        }}
      >
        무대로 가기 →
      </button>

      {editing !== null && (
        <EditSheet
          workId={draft.id}
          keyDef={draft.keys[editing]}
          engine={engine}
          onPatch={(patch) => patchKey(editing, patch)}
          onAddAsset={addAsset}
          artFromPhoto={
            findAsset(draft, draft.keys[editing].appearance.artAssetId)?.source === 'photo'
          }
          onClose={() => {
            setEditing(null);
            void saveDraft({ thumb: true });
          }}
        />
      )}
    </main>
  );
}
