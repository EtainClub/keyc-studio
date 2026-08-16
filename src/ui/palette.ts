/**
 * 아이가 고르는 색 여덟 가지.
 *
 * 키캡 본체 색과 흔적 색이 **같은 목록을 쓴다.** 두 곳에 각자 배열을 두고 있었는데,
 * 그건 "아이에게 같은 색은 같은 이름이어야 한다"를 주석으로만 지키는 상태였다.
 * 실제로 흔적에만 주황·빨강을 더하는 순간 두 목록이 갈라졌을 것이고, 그러면
 * 키캡에서는 못 고르는 색이 흔적에만 있는 화면이 된다.
 *
 * 그래서 목록을 하나로 합쳤다. 색을 더하거나 뺄 곳이 여기 하나다.
 *
 * ## 색을 고른 기준
 *
 * 여덟 가지 전부 **어두운 보라 배경(--bg #150f2b) 위에서 그대로 보여야 한다.**
 * 흔적은 배경 위에 직접 찍히기 때문이고, 키캡도 어두운 상판 위에 놓인다.
 * 그래서 어두운 색(감색·짙은 갈색 같은)은 여기 없다 — 골라도 안 보이는 색은
 * 선택지가 아니라 함정이다.
 *
 * 앞의 넷은 `DEFAULT_COLORS`와 같은 값이다. 새 작품의 키캡 넷이 그 색으로
 * 시작하므로, 아이가 처음 보는 색이 목록 맨 앞에 있어야 한다.
 */

import { t } from '../i18n';
import { DEFAULT_COLORS } from '../work-model/defaults';

export type Swatch = { c: string; label: string };

export const PALETTE: Swatch[] = [
  { c: DEFAULT_COLORS[0], label: t('edit.capColor.pink') },
  { c: DEFAULT_COLORS[1], label: t('edit.capColor.yellow') },
  { c: DEFAULT_COLORS[2], label: t('edit.capColor.green') },
  { c: DEFAULT_COLORS[3], label: t('edit.capColor.blue') },
  /*
   * 주황과 빨강은 불꽃 흔적 때문에 들어왔다. 노랑만으로도 불이 읽히기는 하지만,
   * 아이가 "불은 빨간색"이라고 알고 있는데 그 색이 목록에 없는 것은 설명하기 어렵다.
   *
   * 둘 다 이웃한 색과 헷갈리지 않을 만큼 떨어뜨렸다 — 주황은 노랑에서,
   * 빨강은 분홍에서. 색 이름을 부를 수 없으면 여덟 개는 그냥 여덟 개의 네모다.
   */
  { c: '#FF8A33', label: t('edit.capColor.orange') },
  { c: '#FF4B4B', label: t('edit.capColor.red') },
  { c: '#B98CFF', label: t('edit.capColor.purple') },
  { c: '#FFFFFF', label: t('edit.capColor.white') },
];
