const test = require('node:test');
const assert = require('node:assert/strict');
const { ExtensionClientRegistry, ExtensionCommandCoordinator } = require('../src/main/extension-state');

test('extension registry prefers armed and active meeting tab', () => {
  let now = 1000;
  const registry = new ExtensionClientRegistry({ clock: () => now });
  registry.remember({ clientId: 'background', url: 'https://meet.example/old', visible: true });
  now += 10;
  registry.remember({ clientId: 'meeting', url: 'https://meet.example/current', visible: true, armed: true });
  assert.equal(registry.choose().id, 'meeting');
  registry.clearActive('meeting');
  assert.equal(registry.getActive(), null);
});


test('blurred armed tab loses active priority and visible tab is selected', () => {
  let now = 2000;
  const registry = new ExtensionClientRegistry({ clock: () => now });
  registry.remember({ clientId: 'meeting-a', url: 'https://meet.example/a', visible: true, armed: true });
  assert.equal(registry.getActive().id, 'meeting-a');
  now += 10;
  registry.remember({ clientId: 'meeting-b', url: 'https://meet.example/b', visible: true });
  now += 10;
  registry.remember({ clientId: 'meeting-a', url: 'https://meet.example/a', visible: false, armed: true });
  assert.equal(registry.getActive(), null);
  assert.equal(registry.choose().id, 'meeting-b');
  registry.markActive('meeting-a');
  assert.equal(registry.getActive(), null);
});

test('extension coordinator validates ack against session and sequence', async () => {
  let now = 0;
  const coordinator = new ExtensionCommandCoordinator({ sessionId: 'desktop-session', clock: () => now });
  const command = coordinator.issue('start', { id: 'client', url: 'https://meet.example' }, { sourceLang: 'auto' });
  assert.equal(command.seq, 1);
  assert.equal(coordinator.acknowledge({ seq: 1, action: 'start', sessionId: 'wrong' }).ok, false);
  const accepted = coordinator.acknowledge({ seq: 1, action: 'start', sessionId: 'desktop-session', ok: true, clientId: 'client' });
  assert.equal(accepted.ok, true);
  const ack = await coordinator.waitForAck(1, 10);
  assert.equal(ack.clientId, 'client');
});
