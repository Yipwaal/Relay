import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRelayDb } from '../../db';
import { createConversationStore } from '../store';
import { createImageStore } from '../images-store';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup() {
  const db = openRelayDb(':memory:');
  const conversations = createConversationStore(db);
  const images = createImageStore(db);
  const c = conversations.create({ modelMode: 'auto', model: '', options: { numCtx: 8192, numPredict: 1024, temperature: 0.7 } });
  return { conversations, images, conversationId: c.id };
}

test('afbeeldingen worden in dezelfde transactie als het bericht opgeslagen en per bericht teruggegeven', () => {
  const { conversations, images, conversationId } = setup();
  const messageId = conversations.appendUserMessage(conversationId, 'Wat zie je?', (id) =>
    images.insert(id, [
      { name: 'a.png', mime: 'image/png', data: PNG },
      { name: 'b.png', mime: 'image/png', data: PNG },
    ]),
  );
  const listed = images.listForConversation(conversationId);
  assert.deepEqual(listed.map((i) => [i.messageId, i.name]), [
    [messageId, 'a.png'],
    [messageId, 'b.png'],
  ]);
  assert.equal(images.countFor(messageId), 2);
  assert.deepEqual([...(images.get(listed[0]!.id)?.data ?? [])], [...PNG]);
  assert.equal(images.forMessages([messageId]).get(messageId)?.[0]?.base64, Buffer.from(PNG).toString('base64'));
});

test('mislukt het opslaan van een afbeelding, dan wordt ook het bericht niet bewaard', () => {
  const { conversations, images, conversationId } = setup();
  assert.throws(() =>
    conversations.appendUserMessage(conversationId, 'x', (id) =>
      images.insert(id, [
        { name: 'a.png', mime: 'image/png', data: PNG },
        { name: 'b.png', mime: 'image/png', data: null as unknown as Uint8Array },
      ]),
    ),
  );
  assert.equal(conversations.listMessages(conversationId).length, 0);
  assert.equal(images.listForConversation(conversationId).length, 0);
});

test('een gesprek verwijderen verwijdert ook zijn afbeeldingen', () => {
  const { conversations, images, conversationId } = setup();
  const messageId = conversations.appendUserMessage(conversationId, 'x', (id) => images.insert(id, [{ name: 'a.png', mime: 'image/png', data: PNG }]));
  conversations.delete(conversationId);
  assert.equal(images.countFor(messageId), 0);
});
