/**
 * 되돌릴 수 없는 일을 하기 전에 한 번 묻는 창.
 *
 * 브라우저 `confirm()`을 쓰지 않는 이유:
 *   1. OS 스타일이라 이 앱의 화면에서 혼자 튄다. 아이 입장에서는 다른 앱이 끼어든 것처럼 보인다.
 *   2. "확인/취소" 두 글자뿐이라 무엇이 사라지는지 알려줄 자리가 없다.
 *   3. 위험한 쪽이 기본 버튼이 되기 쉽다. 여기서는 **되돌아가기가 먼저이고 더 크다.**
 *
 * 파괴적인 버튼은 오른쪽에, 색으로 구분해 둔다.
 */

import { useRef } from 'react';
import { useModalShell } from '../hooks';

type Props = {
  title: string;
  /** 무엇이 사라지는지 구체적으로. "정말요?"만 묻지 않는다. */
  detail?: string;
  /** 파괴적인 쪽 버튼의 글자. 무슨 일이 일어나는지 그대로 적는다. */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  cancelLabel = '그만두기',
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  useModalShell(ref, onCancel);

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <section
        ref={ref}
        className="sheet confirm"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="confirm-title">{title}</h2>
        {detail && <p className="note">{detail}</p>}
        <div className="confirm-actions">
          {/* 돌아가는 쪽이 먼저이자 기본. 열자마자 포커스가 여기 앉는다. */}
          <button type="button" className="chip big" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="chip big danger-solid" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
