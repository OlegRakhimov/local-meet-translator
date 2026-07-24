class ExtensionClientRegistry {
  constructor({ clock = () => Date.now(), retentionMs = 5 * 60 * 1000 } = {}) {
    this.clock = clock;
    this.retentionMs = retentionMs;
    this.clients = new Map();
    this.activeClientId = '';
  }

  remember({ clientId, url, visible, armed = false }) {
    const id = String(clientId || '').trim();
    const cleanUrl = String(url || '').trim();
    if (!id || !cleanUrl) return null;
    const now = this.clock();
    const previous = this.clients.get(id);
    const client = {
      id,
      url: cleanUrl.slice(0, 500),
      visible: Boolean(visible),
      lastSeen: now,
      firstSeen: previous ? previous.firstSeen : now,
      lastVisibleAt: visible ? now : (previous ? previous.lastVisibleAt : 0),
      armedAt: armed ? now : (previous ? previous.armedAt : 0)
    };
    this.clients.set(id, client);
    if (armed) this.activeClientId = id;
    return { ...client };
  }

  recent(maxAgeMs = 120000) {
    const now = this.clock();
    for (const [id, client] of this.clients) {
      if (now - client.lastSeen > this.retentionMs) this.clients.delete(id);
    }
    return Array.from(this.clients.values())
      .filter((client) => now - client.lastSeen <= maxAgeMs)
      .map((client) => ({ ...client }));
  }

  choose() {
    const clients = this.recent();
    clients.sort((a, b) =>
      Number(b.id === this.activeClientId) - Number(a.id === this.activeClientId)
      || (b.armedAt || 0) - (a.armedAt || 0)
      || Number(Boolean(b.visible)) - Number(Boolean(a.visible))
      || (b.lastVisibleAt || 0) - (a.lastVisibleAt || 0)
      || b.lastSeen - a.lastSeen
    );
    return clients[0] || null;
  }

  getActive() {
    return this.activeClientId ? this.clients.get(this.activeClientId) || null : null;
  }

  markActive(clientId) {
    const id = String(clientId || '').trim();
    if (id && this.clients.has(id)) this.activeClientId = id;
  }

  clearActive(clientId = '') {
    if (!clientId || clientId === this.activeClientId) this.activeClientId = '';
  }
}

class ExtensionCommandCoordinator {
  constructor({ sessionId, clock = () => Date.now(), logger = () => {} }) {
    this.sessionId = sessionId;
    this.clock = clock;
    this.logger = logger;
    this.sequence = 0;
    this.command = { seq: 0, sessionId, action: 'idle', issuedAt: 0 };
    this.lastAck = null;
  }

  issue(action, target, config, overrides = {}) {
    this.sequence += 1;
    this.lastAck = null;
    this.command = {
      seq: this.sequence,
      sessionId: this.sessionId,
      action,
      issuedAt: this.clock(),
      targetClientId: target ? target.id : '',
      targetUrl: target ? target.url : '',
      ...(config || {}),
      ...(overrides || {})
    };
    return { ...this.command };
  }

  acknowledge(data) {
    const seq = Number(data.seq || 0);
    const action = String(data.action || '?');
    const sessionId = String(data.sessionId || '');
    if (seq !== this.command.seq || action !== this.command.action || sessionId !== this.sessionId) {
      return { ok: false, error: 'ACK does not match the active command' };
    }
    this.lastAck = {
      seq,
      action,
      ok: data.ok === undefined ? true : Boolean(data.ok),
      text: data.message || data.error || '',
      details: data.details || {},
      clientId: String(data.clientId || ''),
      sessionId,
      at: this.clock()
    };
    return { ok: true, ack: { ...this.lastAck } };
  }

  waitForAck(seq, timeoutMs = 22000) {
    return new Promise((resolve) => {
      const startedAt = this.clock();
      const timer = setInterval(() => {
        if (this.lastAck && this.lastAck.seq === seq) {
          clearInterval(timer);
          resolve({ ...this.lastAck });
        } else if (this.clock() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, 100);
    });
  }

  snapshot() {
    return { command: { ...this.command }, lastAck: this.lastAck ? { ...this.lastAck } : null };
  }
}

module.exports = { ExtensionClientRegistry, ExtensionCommandCoordinator };
