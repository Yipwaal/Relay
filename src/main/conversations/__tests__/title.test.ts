import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGeneratedTitle, generateTitle, provisionalTitle } from '../title';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('provisionalTitle kapt af op een woordgrens rond 40 tekens', () => {
  assert.equal(provisionalTitle('Korte vraag?'), 'Korte vraag?');
  assert.equal(provisionalTitle('Wat is de opzegtermijn als ik als huurder wil stoppen?'), 'Wat is de opzegtermijn als ik als…');
  assert.equal(provisionalTitle('Eerste regel\nTweede regel'), 'Eerste regel');
  assert.equal(provisionalTitle('   '), 'Nieuw gesprek');
});

test('cleanGeneratedTitle maakt er één schone korte regel van', () => {
  assert.equal(cleanGeneratedTitle('"Opzegtermijn huurcontract."'), 'Opzegtermijn huurcontract');
  assert.equal(cleanGeneratedTitle('Titel: **Zuurdesem voeden**\nUitleg: ...'), 'Zuurdesem voeden');
  assert.equal(cleanGeneratedTitle('<think>even nadenken</think>\nVakantie Portugal'), 'Vakantie Portugal');
  assert.equal(cleanGeneratedTitle('   \n  '), null);
  assert.ok((cleanGeneratedTitle('x'.repeat(200)) ?? '').length <= 60);
});

test('generateTitle vraagt een korte, niet-streamende samenvatting aan hetzelfde model', async () => {
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ message: { content: 'Opzegtermijn huurcontract' } }), { status: 200 });
  }) as typeof fetch;

  const title = await generateTitle('http://localhost:11434', 'gemma4:12b', 'Wat is de opzegtermijn?', 'Eén maand.');
  assert.equal(title, 'Opzegtermijn huurcontract');
  assert.equal(body.model, 'gemma4:12b');
  assert.equal(body.stream, false);
});

test('generateTitle geeft null als Ollama faalt, zodat de voorlopige titel blijft staan', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  assert.equal(await generateTitle('http://localhost:11434', 'm', 'a', 'b'), null);
});
