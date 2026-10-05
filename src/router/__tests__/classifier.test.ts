import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassifyRequest, classifyMessage, parseClassification, type ChatTransport } from '../classifier';

test('parseClassification accepteert alleen de afgesproken waarden', () => {
  assert.deepEqual(parseClassification('{"taak":"code","complexiteit":"hoog"}'), { taak: 'code', complexiteit: 'hoog' });
  assert.equal(parseClassification('{"taak":"poëzie","complexiteit":"hoog"}'), null);
  assert.equal(parseClassification('{"taak":"code"}'), null);
  assert.equal(parseClassification('geen json'), null);
  assert.equal(parseClassification('["code","hoog"]'), null);
});

test('buildClassifyRequest vraagt JSON volgens het schema aan het background-model', () => {
  const body = buildClassifyRequest('qwen3.5:9b', 'x'.repeat(5000), '30m');
  assert.equal(body.model, 'qwen3.5:9b');
  assert.equal(body.stream, false);
  assert.equal(body.keep_alive, '30m');
  const format = body.format as { properties: { taak: { enum: string[] }; complexiteit: { enum: string[] } } };
  assert.deepEqual(format.properties.taak.enum, ['chat', 'redeneren', 'code', 'onderzoek']);
  assert.deepEqual(format.properties.complexiteit.enum, ['laag', 'middel', 'hoog']);
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[1]?.content.length, 2000);
});

test('classifyMessage geeft de classificatie van het model terug', async () => {
  const transport: ChatTransport = async () => '{"taak":"onderzoek","complexiteit":"middel"}';
  const result = await classifyMessage(transport, 'bg', 'Vergelijk deze drie offertes', 3000, '30m');
  assert.deepEqual(result.classification, { taak: 'onderzoek', complexiteit: 'middel' });
  assert.equal(result.error, undefined);
});

test('classifyMessage geeft op tijd op als het model te traag is, en breekt het verzoek af', async () => {
  let aborted = false;
  const transport: ChatTransport = (_body, signal) =>
    new Promise(() => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
    });
  const started = Date.now();
  const result = await classifyMessage(transport, 'bg', 'x', 50, '30m');
  assert.equal(result.classification, null);
  assert.match(result.error ?? '', /langer dan 50 ms/);
  assert.ok(Date.now() - started < 1000);
  assert.equal(aborted, true);
});

test('classifyMessage vangt fouten en ongeldige antwoorden af', async () => {
  const failing: ChatTransport = async () => {
    throw new Error('Ollama lijkt niet te draaien');
  };
  assert.match((await classifyMessage(failing, 'bg', 'x', 3000, '30m')).error ?? '', /niet te draaien/);
  const nonsense: ChatTransport = async () => 'ik denk code';
  assert.equal((await classifyMessage(nonsense, 'bg', 'x', 3000, '30m')).error, 'ongeldige classificatie');
});
