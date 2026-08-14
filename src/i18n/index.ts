/**
 * 말 고르기 — 한국어/영어.
 *
 * 언어는 앱이 뜰 때 **한 번** 정해지고 그 뒤로 바뀌지 않는다. 그래서 `t()`는
 * 리액트 밖(스토리지·모델 계층의 오류 메시지 등)에서도 그냥 부를 수 있고,
 * 화면은 언어 때문에 다시 그릴 일이 없다.
 *
 * 고르는 순서는 `?lang=` → 저장된 값 → 기기 언어다. 앞의 둘은 QA와 공유 링크용
 * 뒷문이고, 실제 사용자에게는 사실상 기기 언어만 쓰인다.
 */

import { en } from './en';
import { ko } from './ko';

export type Lang = 'ko' | 'en';

/** 사용자가 고른 값. 'system'은 "고르지 않았다"는 뜻이고, 저장소에는 아무것도 없다. */
export type LangPreference = Lang | 'system';

export type MessageKey = keyof typeof ko;

const DICTS: Record<Lang, Record<MessageKey, string>> = { ko, en };
const STORAGE_KEY = 'keyc.lang';

function isLang(value: string | null | undefined): value is Lang {
  return value === 'ko' || value === 'en';
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // 사생활 보호 모드에서는 localStorage를 못 읽는다. 그냥 기기 언어로 간다.
    return null;
  }
}

/**
 * 한국어 기기만 한국어, 나머지는 전부 영어다.
 *
 * "ko가 아니면 영어"로 두는 쪽이 안전하다 — 반대로 하면(영어만 영어) 일본어·
 * 스페인어 기기에 아무도 못 읽는 한국어가 남는다.
 */
function detect(): Lang {
  if (typeof navigator === 'undefined') return 'ko';
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    if (tag?.toLowerCase().startsWith('ko')) return 'ko';
  }
  return 'en';
}

function resolve(): Lang {
  const stored = readStored();

  if (typeof location !== 'undefined') {
    const requested = new URLSearchParams(location.search).get('lang');
    if (isLang(requested)) {
      try {
        localStorage.setItem(STORAGE_KEY, requested);
      } catch {
        // 저장을 못 해도 이번 방문에는 적용된다.
      }
      return requested;
    }
  }

  if (isLang(stored)) return stored;
  return detect();
}

/** 프로필 화면이 지금 어느 칸에 불이 들어와야 하는지 알기 위해 쓴다. */
export function langPreference(): LangPreference {
  const stored = readStored();
  return isLang(stored) ? stored : 'system';
}

/**
 * 언어를 바꾸고 앱을 **다시 불러온다.**
 *
 * 새로고침이 게으른 선택이 아니라 맞는 선택이다. PRESETS·FEELS·MOTIONS·LEDS·
 * VOICE_MODES·TRACE_STRENGTHS·MISSIONS·SORTS·GUIDE_STEPS는 전부 모듈이 로드될 때
 * `t()`로 **한 번** 만들어진다. `lang`만 갈아끼우고 화면을 다시 그리면 그 목록들은
 * 옛 언어로 남아, 반은 한국어 반은 영어인 화면이 된다.
 *
 * `?lang=`이 주소에 남아 있으면 떼고 간다 — 안 그러면 주소가 방금 고른 값을
 * 도로 덮어쓴다(resolve()에서 주소가 저장값보다 우선하기 때문).
 */
export function applyLangPreference(next: LangPreference): void {
  try {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 저장을 못 하면 바꿀 방법도 없다. 새로고침해도 원래대로 돌아온다.
  }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  location.replace(url.toString());
}

export const lang: Lang = resolve();

/** `toLocaleString` 계열에 넘길 BCP 47 태그. */
export const locale = lang === 'ko' ? 'ko-KR' : 'en-US';

if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;

  /*
   * 탭 제목도 언어를 따른다 — 단, **아직 기본값일 때만.**
   *
   * `/w/**`는 Hosting rewrite가 작품별 제목을 박아 넣은 HTML을 준다. 무조건
   * 덮어쓰면 영어 사용자만 그 작품 제목을 잃는다. 그래서 index.html의 기본
   * 제목과 글자까지 같을 때만 바꾼다.
   */
  if (document.title === ko['meta.defaultTitle']) {
    document.title = DICTS[lang]['meta.defaultTitle'];
  }
}

/**
 * 문구 하나를 고른다. `{이름}` 자리는 `vars`로 채운다.
 *
 * `vars.n`이 1이면 `키_one`이 있는지 먼저 본다 — 영어의 단수/복수 때문이다
 * (한국어 사전에는 `_one`을 둘 이유가 없다).
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const dict = DICTS[lang];
  let template: string | undefined = dict[key];

  if (vars?.n === 1) {
    const one = dict[`${key}_one` as MessageKey];
    if (one !== undefined) template = one;
  }

  if (template === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] 빠진 문구: ${key} (${lang})`);
    return key;
  }

  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** 숫자를 현재 언어의 자릿수 표기로. `1234` → `1,234`. */
export function num(value: number): string {
  return value.toLocaleString(locale);
}
