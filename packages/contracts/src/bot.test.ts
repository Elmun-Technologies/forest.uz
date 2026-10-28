import { describe, expect, it } from 'vitest';
import { BOT_COMPLAINT_KEYWORDS, botLocale, isOperatorHours, matchesComplaint } from './bot';
import { fromTashkent } from './time';

describe('matchesComplaint', () => {
  it('finds Uzbek and Russian keywords by word prefix, any script and apostrophe', () => {
    expect(matchesComplaint('Shikoyatim bor, rang yomon chiqdi', BOT_COMPLAINT_KEYWORDS)).toBe(
      true,
    );
    expect(matchesComplaint('Это ЖАЛОБА на курьера', BOT_COMPLAINT_KEYWORDS)).toBe(true);
    expect(matchesComplaint('Пульверизатор — брак', BOT_COMPLAINT_KEYWORDS)).toBe(true);
    expect(matchesComplaint('Pulimni qaytarib bering', BOT_COMPLAINT_KEYWORDS)).toBe(true);
    expect(matchesComplaint('Шикоят', ['shikoyat'])).toBe(true);
  });

  it('does not flag ordinary questions', () => {
    expect(matchesComplaint('Shu kresloga qaysi rang mos?', BOT_COMPLAINT_KEYWORDS)).toBe(false);
    expect(matchesComplaint('Курьер когда приедет?', BOT_COMPLAINT_KEYWORDS)).toBe(false);
    expect(matchesComplaint('', BOT_COMPLAINT_KEYWORDS)).toBe(false);
  });
});

describe('isOperatorHours (Tashkent)', () => {
  const rules = { operatorDays: [1, 2, 3, 4, 5, 6], operatorStart: '09:00', operatorEnd: '21:00' };

  it('is open Mon–Sat 09:00–21:00 and closed otherwise', () => {
    // 2026-10-27 is a Tuesday.
    expect(isOperatorHours(rules, fromTashkent(2026, 10, 27, 9, 0))).toBe(true);
    expect(isOperatorHours(rules, fromTashkent(2026, 10, 27, 20, 59))).toBe(true);
    expect(isOperatorHours(rules, fromTashkent(2026, 10, 27, 21, 0))).toBe(false);
    expect(isOperatorHours(rules, fromTashkent(2026, 10, 27, 8, 59))).toBe(false);
    // Sunday.
    expect(isOperatorHours(rules, fromTashkent(2026, 11, 1, 12, 0))).toBe(false);
  });

  it('handles windows across midnight', () => {
    const night = {
      operatorDays: [0, 1, 2, 3, 4, 5, 6],
      operatorStart: '22:00',
      operatorEnd: '02:00',
    };
    expect(isOperatorHours(night, fromTashkent(2026, 10, 27, 23, 0))).toBe(true);
    expect(isOperatorHours(night, fromTashkent(2026, 10, 27, 1, 0))).toBe(true);
    expect(isOperatorHours(night, fromTashkent(2026, 10, 27, 12, 0))).toBe(false);
  });
});

describe('botLocale (docs/09 language rules)', () => {
  it('prefers /til, then the site locale, then Telegram language_code', () => {
    expect(botLocale({ explicit: 'ru', customer: 'uz', languageCode: 'uz' })).toBe('ru');
    expect(botLocale({ customer: 'ru', languageCode: 'uz' })).toBe('ru');
    expect(botLocale({ languageCode: 'ru-RU' })).toBe('ru');
    expect(botLocale({ languageCode: 'en' })).toBe('uz');
    expect(botLocale({})).toBe('uz');
  });

  it('stays within the enabled languages', () => {
    expect(botLocale({ languageCode: 'ru', enabled: ['uz'] })).toBe('uz');
  });
});
