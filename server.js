const express = require('express');
const { WebSocketServer } = require('ws');
const { randomBytes } = require('crypto');

const app = express();
app.get('/healthz', (_, res) => res.send('ok'));
app.use(express.static(__dirname));

/* ── Session store ── */
const sessions = new Map(); // id → session

const COLORS = ['#2d7d5a', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899'];

function uid(len = 6) {
  return randomBytes(len).toString('hex').slice(0, len).toUpperCase();
}

function createSession(hostId, hostName) {
  let id;
  do { id = uid(6); } while (sessions.has(id));
  const session = {
    id,
    decision: '',
    options: [],          // { id, name, desc, addedBy }
    criteria: [],         // full criterion objects
    participants: {       // pid → { id, name, color, connected, isHost }
      [hostId]: { id: hostId, name: hostName, color: COLORS[0], connected: true, isHost: true }
    },
    scores: {},           // pid → { criterionId: [score per option] }
    createdAt: Date.now()
  };
  sessions.set(id, session);
  return session;
}

function snapshot(session) {
  return {
    id: session.id,
    decision: session.decision,
    options: session.options,
    criteria: session.criteria,
    participants: Object.values(session.participants).map(({ id, name, color, connected, isHost }) =>
      ({ id, name, color, connected, isHost })),
    scores: session.scores
  };
}

function broadcast(session, msg, skipWs = null) {
  const raw = JSON.stringify(msg);
  Object.values(session.participants).forEach(p => {
    if (p._ws && p._ws !== skipWs && p._ws.readyState === 1) {
      p._ws.send(raw);
    }
  });
}

function syncAll(session) {
  broadcast(session, { type: 'sync', session: snapshot(session) });
}

/* ── WebSocket server ── */
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lucid server → http://0.0.0.0:${PORT}`);
});
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  let pid = null;
  let sid = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const session = sid ? sessions.get(sid) : null;

    switch (msg.type) {

      case 'create': {
        pid = uid(8);
        const name = String(msg.name || 'Hôte').slice(0, 40);
        const s = createSession(pid, name);
        sid = s.id;
        s.participants[pid]._ws = ws;
        ws.send(JSON.stringify({ type: 'created', participantId: pid, session: snapshot(s) }));
        break;
      }

      case 'join': {
        const s = sessions.get(String(msg.sessionId || '').toUpperCase());
        if (!s) { ws.send(JSON.stringify({ type: 'error', message: 'Session introuvable. Vérifiez le code.' })); return; }
        pid = uid(8);
        sid = s.id;
        const name = String(msg.name || 'Participant').slice(0, 40);
        const colorIdx = Object.keys(s.participants).length % COLORS.length;
        s.participants[pid] = { id: pid, name, color: COLORS[colorIdx], connected: true, isHost: false, _ws: ws };
        // Init scores for existing options/criteria
        s.scores[pid] = {};
        s.criteria.forEach(cr => {
          s.scores[pid][cr.id] = s.options.map(() => 5);
        });
        ws.send(JSON.stringify({ type: 'joined', participantId: pid, session: snapshot(s) }));
        broadcast(s, { type: 'sync', session: snapshot(s) }, ws);
        break;
      }

      case 'set_decision': {
        if (!session) return;
        session.decision = String(msg.value || '').slice(0, 200);
        syncAll(session);
        break;
      }

      case 'add_option': {
        if (!session) return;
        if (session.options.length >= 8) return;
        const optId = uid(8);
        session.options.push({ id: optId, name: String(msg.name || '').slice(0, 80), desc: String(msg.desc || '').slice(0, 200), addedBy: pid });
        // Extend all participant scores with a 5 for the new option
        Object.keys(session.scores).forEach(p => {
          session.criteria.forEach(cr => {
            if (!session.scores[p][cr.id]) session.scores[p][cr.id] = [];
            session.scores[p][cr.id].push(5);
          });
        });
        syncAll(session);
        break;
      }

      case 'remove_option': {
        if (!session) return;
        const idx = session.options.findIndex(o => o.id === msg.optionId);
        if (idx === -1) return;
        session.options.splice(idx, 1);
        Object.values(session.scores).forEach(pScores => {
          Object.keys(pScores).forEach(cId => { pScores[cId].splice(idx, 1); });
        });
        syncAll(session);
        break;
      }

      case 'add_criterion': {
        if (!session) return;
        if (session.criteria.find(c => c.id === msg.criterion?.id)) return;
        session.criteria.push(msg.criterion);
        // Init scores for all participants for this new criterion
        Object.keys(session.scores).forEach(p => {
          session.scores[p][msg.criterion.id] = session.options.map(() => 5);
        });
        syncAll(session);
        break;
      }

      case 'remove_criterion': {
        if (!session) return;
        session.criteria = session.criteria.filter(c => c.id !== msg.criterionId);
        Object.values(session.scores).forEach(pScores => { delete pScores[msg.criterionId]; });
        syncAll(session);
        break;
      }

      case 'set_score': {
        if (!session) return;
        const crId = msg.criterionId;
        const oi = parseInt(msg.optionIndex);
        const val = Math.max(1, Math.min(10, parseInt(msg.value) || 5));
        if (!session.scores[pid]) session.scores[pid] = {};
        if (!session.scores[pid][crId]) session.scores[pid][crId] = session.options.map(() => 5);
        if (oi >= 0 && oi < session.options.length) session.scores[pid][crId][oi] = val;
        syncAll(session);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!sid || !pid) return;
    const session = sessions.get(sid);
    if (!session || !session.participants[pid]) return;
    session.participants[pid].connected = false;
    session.participants[pid]._ws = null;
    broadcast(session, { type: 'sync', session: snapshot(session) });
  });
});

// Clean sessions older than 24h
setInterval(() => {
  const cutoff = Date.now() - 86400000;
  sessions.forEach((s, id) => { if (s.createdAt < cutoff) sessions.delete(id); });
}, 3600000);
