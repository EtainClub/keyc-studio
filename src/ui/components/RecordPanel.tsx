/**
 * 목소리 녹음 UI.
 *
 * 큰 빨간 버튼 / 3·2·1 카운트다운 / 자동 트림 / "소리가 너무 작아요" 경고 /
 * 다시 녹음 / 미리듣기. 마이크 권한 팝업은 이 버튼을 누른 뒤에야 뜬다.
 */

import { useEffect, useRef, useState } from 'react';
import { VoiceRecorder } from '../../audio-engine/recorder';
import { t } from '../../i18n';
import type { EncodedSound } from '../../audio-engine/wav';

type Phase = 'idle' | 'asking' | 'countdown' | 'recording' | 'review' | 'error';

type Props = {
  onAccept: (sound: EncodedSound) => void | Promise<void>;
  onPreview: (blob: Blob) => void;
};

export function RecordPanel({ onAccept, onPreview }: Props) {
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [count, setCount] = useState(3);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<EncodedSound | null>(null);
  const [error, setError] = useState('');

  useEffect(() => () => recorderRef.current?.dispose(), []);

  const finish = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    const encoded = rec.end();
    setResult(encoded);
    setPhase('review');
  };

  const start = async () => {
    setError('');
    setPhase('asking');
    try {
      const rec = new VoiceRecorder({
        onLevel: setLevel,
        onAutoStop: () => finish(),
      });
      recorderRef.current?.dispose();
      recorderRef.current = rec;
      await rec.prepare();
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? t('record.denied')
          : t('record.failed'),
      );
      setPhase('error');
      return;
    }

    setPhase('countdown');
    setCount(3);
    for (let n = 3; n >= 1; n--) {
      setCount(n);
      await sleep(700);
    }
    recorderRef.current?.begin();
    setPhase('recording');
    await sleep(1500);
    // 자동 종료가 이미 걸렸으면 end()는 같은 결과를 돌려준다.
    finish();
  };

  const accept = async () => {
    if (!result) return;
    await onAccept(result);
    recorderRef.current?.dispose();
    setPhase('idle');
    setResult(null);
  };

  return (
    <div className="recorder">
      {phase === 'idle' && (
        <button type="button" className="rec-button" onClick={start}>
          <span className="rec-dot" />{t('record.cta')}
        </button>
      )}

      {phase === 'asking' && <p className="rec-hint">{t('record.preparing')}</p>}

      {phase === 'countdown' && (
        <div className="rec-count" aria-live="assertive">
          {count}
        </div>
      )}

      {phase === 'recording' && (
        <div className="rec-live">
          <div className="rec-ring" style={{ transform: `scale(${1 + level * 0.6})` }} />
          <p>{t('record.speakNow')}</p>
        </div>
      )}

      {phase === 'review' && result && (
        <div className="rec-review">
          {result.tooQuiet && <p className="warn">{t('record.tooQuiet')}</p>}
          <p className="rec-size">
            {t('record.meta', {
              seconds: result.durationSec.toFixed(1),
              kb: Math.round(result.bytes / 1024),
            })}
          </p>
          <div className="draw-row">
            <button type="button" className="chip" onClick={() => onPreview(result.blob)}>
              {t('record.listen')}
            </button>
            <button type="button" className="chip" onClick={start}>
              {t('record.again')}
            </button>
            <button type="button" className="chip primary" onClick={accept}>
              {t('record.use')}
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="rec-review">
          <p className="warn">{error}</p>
          <button type="button" className="chip" onClick={start}>
            {t('common.retry')}
          </button>
        </div>
      )}
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
