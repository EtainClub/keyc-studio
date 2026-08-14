/**
 * 닉네임 자동 생성.
 *
 * 자유 입력을 막는 것이 목적이다 — 개인정보(실명·학교·전화번호)와 욕설이
 * 들어올 경로를 아예 없앤다. 형용사 + 명사 + 두 자리 숫자.
 *
 * 언어별로 단어를 따로 둔다. 영어 기기에 '파란고래42'가 나오면 읽을 수도,
 * 불러줄 수도 없다. 이미 지어진 닉네임은 그대로 둔다 — 언어를 바꿨다고
 * 남이 알던 이름이 바뀌면 그게 더 나쁘다.
 */

import { lang } from '../i18n';

const ADJECTIVES_KO = [
  '파란', '노란', '빨간', '초록', '보라', '분홍', '하얀', '까만',
  '반짝', '통통', '말랑', '동그란', '납작한', '길쭉한', '조그만', '커다란',
  '빠른', '느긋한', '용감한', '수줍은', '신난', '졸린', '배고픈', '따뜻한',
];

const NOUNS_KO = [
  '고래', '고양이', '강아지', '토끼', '여우', '펭귄', '부엉이', '거북이',
  '다람쥐', '햄스터', '문어', '해파리', '코끼리', '기린', '판다', '너구리',
  '별똥별', '구름', '무지개', '풍선', '단추', '연필', '주전자', '나침반',
];

const ADJECTIVES_EN = [
  'Blue', 'Yellow', 'Red', 'Green', 'Purple', 'Pink', 'White', 'Black',
  'Sparkly', 'Chubby', 'Squishy', 'Round', 'Flat', 'Lanky', 'Tiny', 'Giant',
  'Speedy', 'Easygoing', 'Brave', 'Shy', 'Cheery', 'Sleepy', 'Hungry', 'Cosy',
];

const NOUNS_EN = [
  'Whale', 'Cat', 'Puppy', 'Rabbit', 'Fox', 'Penguin', 'Owl', 'Turtle',
  'Squirrel', 'Hamster', 'Octopus', 'Jellyfish', 'Elephant', 'Giraffe', 'Panda', 'Raccoon',
  'Comet', 'Cloud', 'Rainbow', 'Balloon', 'Button', 'Pencil', 'Kettle', 'Compass',
];

const ADJECTIVES = lang === 'ko' ? ADJECTIVES_KO : ADJECTIVES_EN;
const NOUNS = lang === 'ko' ? NOUNS_KO : NOUNS_EN;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateNickname(): string {
  const n = 10 + Math.floor(Math.random() * 90);
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${n}`;
}
