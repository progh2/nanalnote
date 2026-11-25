import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seoulWeather, weatherText, describe } from '../src/lib/weather.js';

test('날씨 코드와 한 줄 글', () => {
  assert.deepEqual(describe(0), ['☀️', '맑음']);
  assert.equal(describe(63)[1], '비');
  assert.equal(weatherText({ code: 0, max: 6.1, min: -3.9, rain: 0, mm: 0 }), '☀️ 맑음 -4° / 6°');
  assert.equal(weatherText({ code: 63, max: 12.3, min: 1.2, rain: 100, mm: 8 }), '🌧️ 비 1° / 12° · 비 100%');
  assert.equal(weatherText({ code: 71, max: 9.7, min: 1, rain: null, mm: 1.4 }), '🌨️ 눈 1° / 10° · 강수 1.4mm');
  assert.equal(weatherText(null), '');
});

test('예보·과거 API 고르기, 먼 미래는 없음', async () => {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ daily: { weather_code: [2], temperature_2m_max: [5], temperature_2m_min: [-1], precipitation_probability_max: [30], precipitation_sum: [0] } }) };
  };
  const w = await seoulWeather('2026-11-26', '2026-11-25', fetcher);
  assert.deepEqual(w, { code: 2, max: 5, min: -1, rain: 30, mm: 0 });
  assert.match(urls[0], /api\.open-meteo\.com\/v1\/forecast/);
  await seoulWeather('2026-03-03', '2026-11-25', fetcher);
  assert.match(urls[1], /archive-api/);
  assert.equal(await seoulWeather('2027-01-30', '2026-11-25', fetcher), null);
  assert.equal(urls.length, 2);
});
