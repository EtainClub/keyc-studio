/**
 * ② 만들기.
 *
 * 키캡 4개는 이미 색·소리·움직임·느낌이 채워진 상태로 놓여 있다.
 * 아무것도 바꾸지 않고 곧장 무대로 갈 수 있어야 한다 — 빈 캔버스는 벽이다.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t } from '../../i18n';
import { isTossApp } from '../../platform/toss';
import { findAsset, type AssetRef, type KeyIndex } from '../../work-model/types';
import { EditSheet } from '../components/EditSheet';
import { KeycapGrid, type GridHandle } from '../components/KeycapGrid';
import { StorageStatus } from '../components/StorageStatus';
import { useAppState } from '../state';
import { useResumeOnVisible } from '../hooks';

export function CreateScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const groupQuery = params.get('g') ? `?g=${params.get('g')}` : '';
  const { engine, draft, patchKey, patchDraft, saveDraft } = useAppState();
  const gridRef = useRef<GridHandle>(null);
  const [editing, setEditing] = useState<KeyIndex | null>(null);

  useResumeOnVisible(() => void engine.resume());

  useEffect(() => {
    if (!draft) {
      nav('/', { replace: true });
      return;
    }
    engine.setVisualHandler((e) => gridRef.current?.fire(e));
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
        {!isTossApp() && (
          <button type="button" className="bar-back" onClick={() => nav('/')}>
            ‹ {t('common.home')}
          </button>
        )}
        <h1>{t('create.title')}</h1>
      </header>

      <p className="guide">
        {t('create.guide')}
      </p>
      <StorageStatus />

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
          nav(`/stage${groupQuery}`);
        }}
      >
        {t('create.toStage')}
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
            /*
             * 시트가 닫히는 순간 흔적을 한 번 찍어 준다.
             *
             * 이 화면에서 키캡을 누르면 흔적이 찍히는 동시에 편집 시트가 열려
             * 그 위를 덮는다. 그래서 아이는 방금 고른 발자국을 무대까지 가야
             * 처음 본다 — 고르고도 아무 일이 없으니 안 골라진 줄 안다.
             */
            gridRef.current?.previewTrace(editing);
            setEditing(null);
            void saveDraft({ thumb: true });
          }}
        />
      )}
    </main>
  );
}
