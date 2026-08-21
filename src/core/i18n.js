/**
 * Localisation — English and Russian.
 *
 * Yandex requires the game be localised into at least one declared language AND
 * that it pick the language up from the SDK rather than asking the player. That
 * is the whole reason this exists: Russian is not a nice-to-have there, it is
 * the audience.
 *
 * ponytail: a flat object and a lookup function, not an i18n library. There are
 * two languages and ~40 strings; a library would be larger than the strings.
 * `t()` returns the key itself when a string is missing, so a gap shows up on
 * screen as a visible key instead of as `undefined`.
 */

const STRINGS = {
  en: {
    'menu.subtitle': 'Rapid Response',
    'menu.map': 'Map',
    'menu.mode': 'Game mode',
    'menu.play': 'Play',
    'menu.controls': 'WASD move · Mouse aim · Shift sprint · R reload · Esc pause',
    'menu.controls.touch': 'Left thumb moves · Right thumb aims · Tap to fire',
    'menu.fullscreen': 'Fullscreen',
    'load.loading': 'Loading',
    'load.note': 'Generating textures, geometry and shaders — nothing is downloaded.',

    'map.miami': 'Miami',
    'map.miami.blurb': 'A penthouse rooftop under a midday sun — pool deck, bar, helipad terrace.',
    'map.outpost': 'Outpost',
    'map.outpost.blurb': 'A walled desert border post. Two houses, a well street, a loading dock.',
    'map.zone': 'The Zone',
    'map.zone.blurb': 'A Soviet industrial yard. Panel block, workshop, substation, roofs you can climb.',
    'map.strike': 'Strike',
    'map.strike.blurb': 'Two spawns, two lanes, one site. The classic competitive shape.',
    'map.holdout': 'Holdout',
    'map.holdout.blurb': 'A keep with three doors, open ground all around. Built for hordes.',
    'mode.strike': 'Strike',
    'mode.strike.blurb': 'Round-based. Clear the squad to take the round.',
    'mode.horde': 'Holdout',
    'mode.horde.blurb': 'Defend the keep against waves that grow every round.',
    'map.street': 'Market Street',
    'map.street.blurb': 'Full production map — buildings, interiors, props. Slow to load.',
    'map.yard': 'The Yard',
    'map.yard.blurb': 'Compact open arena, one central block to circle. Instant fights.',
    'map.depot': 'Depot',
    'map.depot.blurb': 'Indoor crate aisles and two offices. Loads fast.',
    'map.culdesac': 'Cul-de-Sac',
    'map.culdesac.blurb': 'Two houses facing each other across a street, a bus parked between them, spawns in the back yards.',
    'map.swat': 'Shoot House',
    'map.swat.blurb': 'Close-quarters kill house — six rooms off one corridor. Loads fast.',
    'map.box': 'Whitebox Arena',
    'map.box.blurb': 'Greybox testbed. Loads about twice as fast.',

    'mode.tdm': 'Team Deathmatch',
    'mode.tdm.blurb': 'Two enemy squads garrison the level.',
    'mode.sandbox': 'Free Roam',
    'mode.sandbox.blurb': 'No enemies. For testing movement and weapons.',

    'career.rank': 'Rank',
    'career.kills': 'Eliminations',
    'career.best': 'Best streak',
    'career.next': 'Next unlock',
    'career.next.at': '{n} more eliminations',
    'career.complete': 'Everything unlocked',
    'career.new': 'New',

    'menu.paused': 'PAUSED',
    'menu.resume': 'Resume',
    'menu.locked': 'Locked',
    'menu.locked.at': 'Unlocks at {n} eliminations',
    'menu.exit': 'Exit to Menu',
    'menu.loadout': 'Gunsmith',

    'gun.title': 'GUNSMITH',
    'gun.optic': 'Optic',
    'gun.muzzle': 'Muzzle',
    'gun.mag': 'Magazine',
    'gun.stock': 'Stock',
    'gun.finish': 'Finish',
    'gun.done': 'Done',
    'gun.hint': 'B or Esc to close · parts fit instantly',
  },

  ru: {
    'menu.subtitle': 'Быстрое реагирование',
    'menu.map': 'Карта',
    'menu.mode': 'Режим',
    'menu.play': 'Играть',
    'menu.controls': 'WASD движение · Мышь прицел · Shift бег · R перезарядка · Esc пауза',
    'menu.controls.touch': 'Левый палец — движение · Правый — прицел · Нажми, чтобы стрелять',
    'menu.fullscreen': 'Во весь экран',
    'load.loading': 'Загрузка',
    'load.note': 'Генерация текстур, геометрии и шейдеров — ничего не скачивается.',

    'map.miami': 'Майами',
    'map.miami.blurb': 'Крыша пентхауса под полуденным солнцем: бассейн, бар, вертолётная площадка.',
    'map.outpost': 'Застава',
    'map.outpost.blurb': 'Пограничная застава в пустыне: два дома, улица с колодцем, погрузочная площадка.',
    'map.zone': 'Зона',
    'map.zone.blurb': 'Промзона: панельный дом, цех, подстанция и крыши, на которые можно забраться.',
    'map.strike': 'Страйк',
    'map.strike.blurb': 'Два спавна, две линии, одна точка. Классическая схема.',
    'map.holdout': 'Оплот',
    'map.holdout.blurb': 'Укрытие с тремя входами и открытое поле вокруг. Для орд.',
    'mode.strike': 'Страйк',
    'mode.strike.blurb': 'Раундовый режим. Зачисти отряд — забери раунд.',
    'mode.horde': 'Оплот',
    'mode.horde.blurb': 'Защищай укрытие от волн, которые растут с каждым раундом.',
    'map.street': 'Рыночная улица',
    'map.street.blurb': 'Полноценная карта — здания, интерьеры, объекты. Долгая загрузка.',
    'map.yard': 'Двор',
    'map.yard.blurb': 'Компактная арена с центральным блоком. Бой начинается сразу.',
    'map.depot': 'Склад',
    'map.depot.blurb': 'Ряды ящиков и два офиса. Быстрая загрузка.',
    'map.culdesac': 'Тупик',
    'map.culdesac.blurb': 'Два дома по разные стороны улицы, автобус между ними, точки возрождения — во дворах.',
    'map.swat': 'Штурмовой дом',
    'map.swat.blurb': 'Ближний бой — шесть комнат вдоль коридора. Быстрая загрузка.',
    'map.box': 'Белая арена',
    'map.box.blurb': 'Тестовый полигон. Загружается вдвое быстрее.',

    'mode.tdm': 'Командный бой',
    'mode.tdm.blurb': 'Два вражеских отряда занимают уровень.',
    'mode.sandbox': 'Свободный режим',
    'mode.sandbox.blurb': 'Без врагов. Для проверки движения и оружия.',

    'career.rank': 'Звание',
    'career.kills': 'Устранено',
    'career.best': 'Лучшая серия',
    'career.next': 'Следующая награда',
    'career.next.at': 'ещё {n} устранений',
    'career.complete': 'Всё открыто',
    'career.new': 'Новое',

    'menu.paused': 'ПАУЗА',
    'menu.resume': 'Продолжить',
    'menu.locked': 'Закрыто',
    'menu.locked.at': 'Откроется на {n} устранениях',
    'menu.exit': 'В меню',
    'menu.loadout': 'Оружейная',

    'gun.title': 'ОРУЖЕЙНАЯ',
    'gun.optic': 'Прицел',
    'gun.muzzle': 'Дуло',
    'gun.mag': 'Магазин',
    'gun.stock': 'Приклад',
    'gun.finish': 'Окраска',
    'gun.done': 'Готово',
    'gun.hint': 'B или Esc — закрыть · детали ставятся сразу',
  },
};

/** Ranks are indexed by career level, so they localise as a list. */
const RANKS = {
  en: ['Recruit', 'Officer', 'Sergeant', 'Lieutenant', 'Captain', 'Commander'],
  ru: ['Новобранец', 'Офицер', 'Сержант', 'Лейтенант', 'Капитан', 'Командир'],
};

let lang = 'en';

/** Every language the game declares. Yandex's draft must list the same set. */
export const LANGS = Object.keys(STRINGS);

/**
 * @param {string} [hint]  the portal SDK's language, which wins over the browser's
 */
export function setLang(hint) {
  const want = String(hint ?? navigator.language ?? 'en').slice(0, 2).toLowerCase();
  lang = STRINGS[want] ? want : 'en';
  document.documentElement.lang = lang;
  return lang;
}

export function getLang() {
  return lang;
}

/**
 * @param {string} key
 * @param {Record<string, string|number>} [vars]  `{n}` style substitutions
 */
export function t(key, vars) {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
}

/** @param {number} i  career level */
export function rankName(i) {
  const list = RANKS[lang] ?? RANKS.en;
  return list[Math.min(i, list.length - 1)];
}
