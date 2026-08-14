/**
 * 오늘의 미션 — 하드코딩 30개.
 *
 * 구현비가 거의 0인데 완성률을 크게 올린다. 홈에 한 줄이면 충분하다.
 * 날짜 기준으로 결정론적으로 고르므로 서버도, 저장소도 필요 없다.
 *
 * 사전(i18n/ko.ts)에 넣지 않고 여기 두는 이유: 30개짜리 목록은 문구가 아니라
 * 데이터고, 날짜로 인덱싱하려면 **두 언어의 길이가 같아야** 한다. 한쪽에만
 * 미션을 추가하면 같은 날 기기 언어에 따라 다른 미션이 나온다.
 */

import { lang } from '../i18n';

const MISSIONS_KO: string[] = [
  '동물 소리만 4개로 만들어 보세요',
  '가장 좋아하는 색으로 키캡을 칠해 보세요',
  '우리 집에서 나는 소리를 흉내 내 보세요',
  '무서운 소리 하나를 꼭 넣어 보세요',
  '웃음소리만으로 공연을 만들어 보세요',
  '비 오는 날을 소리로 그려 보세요',
  '로봇이 말하는 것처럼 만들어 보세요',
  '아주 작은 소리 4개를 모아 보세요',
  '우주에 갔을 때 나는 소리를 만들어 보세요',
  '먹을 때 나는 소리를 모아 보세요',
  '키캡 하나에만 그림을 그려 보세요',
  '4개 다 같은 색으로 칠해 보세요',
  '반복을 두 개만 켜고 공연해 보세요',
  '가장 빠른 속도로 공연해 보세요',
  '가장 느린 속도로 공연해 보세요',
  '내 이름을 소리로 만들어 보세요',
  '자동차가 지나가는 소리를 만들어 보세요',
  '바다에서 들리는 소리를 모아 보세요',
  '아기 목소리처럼 높게 만들어 보세요',
  '괴물 목소리처럼 낮게 만들어 보세요',
  '기분이 좋아지는 소리 4개를 골라 보세요',
  '심장이 뛰는 것처럼 만들어 보세요',
  '동생이나 친구를 웃길 소리를 만들어 보세요',
  '한 글자씩 말해서 단어를 만들어 보세요',
  '숲속에 있는 것처럼 만들어 보세요',
  '가장 이상한 소리를 만들어 보세요',
  '그림 없이 색깔로만 꾸며 보세요',
  '4개 키캡으로 이야기를 만들어 보세요',
  '눈을 감고 들어도 알 수 있게 만들어 보세요',
  '오늘 있었던 일을 소리로 남겨 보세요',
];

/** MISSIONS_KO와 **순서도 개수도** 같아야 한다 — 위 주석 참고. */
const MISSIONS_EN: string[] = [
  'Make one out of four animal sounds',
  'Paint the keycaps in your favourite colour',
  'Copy the sounds your home makes',
  'Sneak one scary sound in there',
  'Build a whole show out of laughter',
  'Draw a rainy day using only sound',
  'Make it sound like a robot talking',
  'Collect four very tiny sounds',
  'Make the sounds you would hear in space',
  'Collect the sounds of eating something',
  'Draw on one keycap only',
  'Paint all four the same colour',
  'Perform with only two loops switched on',
  'Perform at the fastest tempo',
  'Perform at the slowest tempo',
  'Turn your own name into sounds',
  'Make the sound of a car driving past',
  'Collect the sounds you hear at the sea',
  'Pitch everything up like a baby voice',
  'Pitch everything down like a monster',
  'Pick four sounds that cheer you up',
  'Make it sound like a beating heart',
  'Make a sound that will crack up a friend',
  'Say one letter per key and spell a word',
  'Make it sound like being deep in a forest',
  'Make the strangest sound you can',
  'Decorate with colour only — no drawings',
  'Tell a story with the four keycaps',
  'Make it clear even with your eyes closed',
  'Keep today as a sound you can play back',
];

export const MISSIONS: string[] = lang === 'ko' ? MISSIONS_KO : MISSIONS_EN;

/** 로컬 날짜 기준. 같은 날이면 언제 열어도 같은 미션이 나온다. */
export function missionOfDay(date: Date = new Date()): string {
  const dayNumber = Math.floor(
    (date.getTime() - date.getTimezoneOffset() * 60_000) / 86_400_000,
  );
  return MISSIONS[((dayNumber % MISSIONS.length) + MISSIONS.length) % MISSIONS.length];
}
