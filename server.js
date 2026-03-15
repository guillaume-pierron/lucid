const express = require('express');
const { WebSocketServer } = require('ws');
const { randomBytes } = require('crypto');

const app = express();
app.get('/healthz', (_, res) => res.send('ok'));
app.use(express.json());

/* ── AI: suggest criteria ── */
app.post('/api/suggest-criteria', async (req, res) => {
  const { decision, lang } = req.body || {};
  if (!decision) return res.status(400).json({ error: 'decision required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const prompt = lang === 'en'
    ? `Decision to make: "${decision}"\n\nSuggest exactly 5 relevant and specific evaluation criteria for this decision. Return ONLY a valid JSON array, no explanation, no markdown:\n[{"icon":"emoji","name":"short name (2-3 words max)","hint":"one-line description"}]`
    : `Décision à prendre : "${decision}"\n\nSuggère exactement 5 critères d'évaluation pertinents et spécifiques pour cette décision. Réponds UNIQUEMENT avec un tableau JSON valide, sans explication, sans markdown :\n[{"icon":"emoji","name":"nom court (2-3 mots max)","hint":"description en une ligne"}]`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await r.json();
    const text = data?.content?.[0]?.text || '[]';
    const match = text.match(/\[[\s\S]*\]/);
    const criteria = match ? JSON.parse(match[0]) : [];
    res.json({ criteria: criteria.slice(0, 5) });
  } catch (e) {
    res.status(500).json({ error: 'AI error', criteria: [] });
  }
});

/* ── AI: clarify synthesis ── */
app.post('/api/clarify-synthesis', async (req, res) => {
  const { answers, lang } = req.body || {};
  if (!answers || !Array.isArray(answers)) return res.status(400).json({ error: 'answers required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const qs = [
    'Quelle est la décision à prendre ?',
    "Qu'est-ce qui empêche de décider facilement ?",
    "Qu'est-ce qui serait perdu si rien n'est fait ?",
    'Dans 5 ans, qu\'aura permis la bonne décision ?',
    'Que conseillerait-on à un ami dans cette situation ?',
    'Au fond, quelle est la décision déjà connue ?',
    'Quel serait le premier pas concret ?',
  ];

  const qa = answers.map((a, i) => `Q${i + 1}: ${qs[i] || ''}\nR: ${a}`).join('\n\n');

  const prompt = lang === 'en'
    ? `Here are someone's answers to guided reflection questions for a decision:\n\n${qa}\n\nProvide a brief, insightful synthesis in 3-4 sentences. Be direct and empathetic. Highlight: (1) the key tension between what they know and what blocks them, (2) what they already know deep down, (3) one concrete encouragement. Avoid generic advice. Speak directly to the person.`
    : `Voici les réponses d'une personne à des questions de réflexion guidée pour une décision :\n\n${qa}\n\nRédige une synthèse courte et perspicace en 3-4 phrases. Sois direct(e) et empathique. Mets en lumière : (1) la tension principale entre ce que la personne sait et ce qui la bloque, (2) ce qu'elle sait déjà au fond d'elle, (3) une encouragement concret. Évite les conseils génériques. Parle directement à la personne (tutoiement).`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 350, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    res.json({ synthesis: data?.content?.[0]?.text || '' });
  } catch (e) {
    res.status(500).json({ error: 'AI error', synthesis: '' });
  }
});

/* ── AI: peser analysis ── */
app.post('/api/peser-analysis', async (req, res) => {
  const { context, scenarios, reversible, inactionImpact, lang } = req.body || {};
  if (!context) return res.status(400).json({ error: 'context required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const scenarioText = (scenarios || []).map(s =>
    `- ${s.name} (prob: ${s.prob}%, impact: ${s.impact}/5)${s.desc ? ': ' + s.desc : ''}`
  ).join('\n');

  const prompt = lang === 'en'
    ? `Decision: "${context}"\nReversible: ${reversible ? 'yes' : 'no'}\nCost of inaction: ${inactionImpact}/5\n\nScenarios:\n${scenarioText}\n\nIn 3-4 sentences: give a personalized risk-benefit verdict. Reference the specific scenarios described. Factor in loss aversion (losses feel 2x worse than equivalent gains) and reversibility. End with one concrete recommendation.`
    : `Décision : "${context}"\nRéversible : ${reversible ? 'oui' : 'non'}\nCoût de l'inaction : ${inactionImpact}/5\n\nScénarios :\n${scenarioText}\n\nEn 3-4 phrases : donne un verdict risques-bénéfices personnalisé. Réfère-toi aux scénarios décrits. Tiens compte de l'aversion à la perte (les pertes semblent 2× plus intenses que les gains équivalents) et de la réversibilité. Termine par une recommandation concrète. Tutoiement.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 350, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    res.json({ analysis: data?.content?.[0]?.text || '' });
  } catch (e) {
    res.status(500).json({ error: 'AI error', analysis: '' });
  }
});

/* ── AI: detect biases (deep psychological analysis) ── */
app.post('/api/detect-biases', async (req, res) => {
  const { decision, options, criteria, scores, lang } = req.body || {};
  if (!decision) return res.status(400).json({ error: 'decision required' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const optionsText = (options || []).map((o, i) => `${i+1}. ${o.name}${o.desc ? ': '+o.desc : ''}`).join('\n');
  const criteriaText = (criteria || []).map(c => `- ${c.name} (poids: ${c.weight||1})`).join('\n');

  const prompt = lang === 'en'
    ? `You are an expert cognitive psychologist specializing in decision biases (Kahneman, Tversky, Ariely, Thaler).
Analyze this decision and detect cognitive biases present:

DECISION: "${decision}"
OPTIONS:\n${optionsText}
CRITERIA:\n${criteriaText}

Return ONLY a valid JSON array (max 4 biases). Each item:
{"bias":"exact bias name","severity":"low|medium|high","explanation":"1-2 sentences specific to this exact decision","suggestion":"1 concrete counter-measure"}
Only include biases genuinely relevant. Return [] if none.`
    : `Tu es expert en psychologie cognitive spécialisé dans les biais décisionnels (Kahneman, Tversky, Ariely, Thaler).
Analyse cette décision et détecte les biais cognitifs réellement présents :

DÉCISION : "${decision}"
OPTIONS :\n${optionsText}
CRITÈRES :\n${criteriaText}

Réponds UNIQUEMENT avec un tableau JSON valide (max 4 biais). Chaque élément :
{"bias":"nom exact du biais","severity":"low|medium|high","explanation":"1-2 phrases spécifiques à CETTE décision précise","suggestion":"1 contre-mesure concrète actionnable"}
N'inclus que les biais réellement pertinents. Retourne [] si aucun.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    const text = data?.content?.[0]?.text || '[]';
    const match = text.match(/\[[\s\S]*\]/);
    const biases = match ? JSON.parse(match[0]) : [];
    res.json({ biases: biases.slice(0, 4) });
  } catch (e) {
    res.status(500).json({ error: 'AI error', biases: [] });
  }
});

/* ── AI: socratic coach ── */
app.post('/api/coach', async (req, res) => {
  const { decision, history, lang } = req.body || {};
  if (!decision) return res.status(400).json({ error: 'decision required' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const historyText = (history || []).map(h => `Q: ${h.q}\nR: ${h.a}`).join('\n\n');

  const system = lang === 'en'
    ? `You are Dr. Lucid, a wise decision coach inspired by Socrates, Carl Rogers, and positive psychology.
Your role: help people think more clearly through powerful questions.
Rules: Ask ONE question at a time. Be specific to their situation. Explore values, consequences, emotions, hidden assumptions. Be warm and non-judgmental. Never tell them what to decide. Build on their previous answer. Keep questions under 25 words.`
    : `Tu es Dr. Lucid, un coach décisionnel inspiré de Socrate, Carl Rogers et la psychologie positive.
Ton rôle : aider à penser plus clairement par des questions puissantes.
Règles : Pose UNE seule question à la fois. Sois spécifique à leur situation. Explore valeurs, conséquences, émotions, hypothèses cachées. Sois chaleureux et sans jugement. Ne dis jamais quoi décider. Appuie-toi sur leur réponse précédente. Questions courtes, moins de 25 mots.`;

  const user = lang === 'en'
    ? `Decision I face: "${decision}"\n\n${historyText ? 'Our conversation:\n' + historyText + '\n\n' : ''}Ask me your next powerful coaching question. ONLY the question, nothing else.`
    : `Décision que je dois prendre : "${decision}"\n\n${historyText ? 'Notre conversation :\n' + historyText + '\n\n' : ''}Pose-moi ta prochaine question de coaching puissante. UNIQUEMENT la question, rien d'autre.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, system, messages: [{ role: 'user', content: user }] })
    });
    const data = await r.json();
    res.json({ question: data?.content?.[0]?.text?.trim() || '' });
  } catch (e) {
    res.status(500).json({ error: 'AI error', question: '' });
  }
});

/* ── AI: narrative synthesis ── */
app.post('/api/narrative', async (req, res) => {
  const { decision, options, criteria, scores, ranked, lang } = req.body || {};
  if (!decision) return res.status(400).json({ error: 'decision required' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const winner = options?.[ranked?.[0]];
  const optSummary = (options || []).map((o, i) => {
    const pos = (ranked || []).indexOf(i) + 1;
    const top = (criteria || []).map(c => ({
      name: c.name,
      eff: c.invert ? 11 - (scores?.[c.id]?.[i] ?? 5) : (scores?.[c.id]?.[i] ?? 5),
      w: c.weight || 1
    })).sort((a, b) => b.eff * b.w - a.eff * a.w)[0];
    return `"${o.name}" (#${pos})${top ? ' — fort sur: ' + top.name + ' (' + top.eff + '/10)' : ''}`;
  }).join('\n');

  const prompt = lang === 'en'
    ? `You're a decision psychologist writing a personal narrative for someone who just completed a structured decision analysis.

Decision: "${decision}"
Options: \n${optSummary}
Winner: "${winner?.name}"

Write 4-5 sentences that:
1. Acknowledge the difficulty and importance of this choice
2. Reveal what the analysis says about their values and priorities
3. Give psychological meaning to why "${winner?.name}" emerged (not just "it scored highest")
4. Include one forward-looking encouragement

Style: warm, human, psychologically insightful. No bullets. Second person ("you"). Don't start with "I" or "Your analysis".`
    : `Tu es psychologue décisionnel et tu écris un récit personnel pour quelqu'un qui vient de compléter une analyse structurée.

Décision : "${decision}"
Options :\n${optSummary}
Gagnant : "${winner?.name}"

Écris 4-5 phrases qui :
1. Reconnaissent la difficulté et l'importance de ce choix
2. Révèlent ce que l'analyse dit de ses valeurs et priorités
3. Donnent un sens psychologique à pourquoi "${winner?.name}" a émergé
4. Incluent un encouragement tourné vers l'avenir

Style : chaleureux, humain, perspicace. Pas de puces. Tutoiement. Ne commence pas par "Je" ou "Ton analyse".`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    res.json({ narrative: data?.content?.[0]?.text?.trim() || '' });
  } catch (e) {
    res.status(500).json({ error: 'AI error', narrative: '' });
  }
});

/* ── AI: temporal consequences simulation ── */
app.post('/api/temporal', async (req, res) => {
  const { decision, option, criteria, scores, optionIndex, lang } = req.body || {};
  if (!decision || !option) return res.status(400).json({ error: 'decision and option required' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const critText = (criteria || []).map(c => `${c.name}: ${scores?.[c.id]?.[optionIndex] ?? 5}/10`).join(', ');

  const prompt = lang === 'en'
    ? `Expert in temporal decision analysis. Simulate consequences of choosing "${option}" for: "${decision}".

Criteria scores: ${critText}

Return ONLY valid JSON:
{"short":{"timeframe":"3 months","positive":"1-2 realistic sentences about early benefits","challenge":"1-2 sentences about early difficulties","emotion":"optimistic|anxious|excited|uncertain"},"medium":{"timeframe":"1 year","positive":"...","challenge":"...","emotion":"satisfied|stressed|fulfilled|mixed"},"long":{"timeframe":"5 years","positive":"...","challenge":"...","emotion":"proud|regretful|content|transformed"}}

Be specific to this decision, not generic.`
    : `Expert en analyse temporelle des décisions. Simule les conséquences du choix "${option}" pour : "${decision}".

Scores critères : ${critText}

Réponds UNIQUEMENT avec du JSON valide :
{"short":{"timeframe":"3 mois","positive":"1-2 phrases réalistes sur les bénéfices précoces","challenge":"1-2 phrases sur les difficultés initiales","emotion":"optimiste|anxieux|enthousiaste|incertain"},"medium":{"timeframe":"1 an","positive":"...","challenge":"...","emotion":"satisfait|stressé|épanoui|mitigé"},"long":{"timeframe":"5 ans","positive":"...","challenge":"...","emotion":"fier|regret|serein|transformé"}}

Sois spécifique à CETTE décision, pas générique.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    const text = data?.content?.[0]?.text || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    const temporal = match ? JSON.parse(match[0]) : {};
    res.json({ temporal });
  } catch (e) {
    res.status(500).json({ error: 'AI error', temporal: {} });
  }
});

/* ── AI: framework recommendation ── */
app.post('/api/framework', async (req, res) => {
  const { decision, urgency, reversibility, complexity, numOptions, lang } = req.body || {};
  if (!decision) return res.status(400).json({ error: 'decision required' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const prompt = lang === 'en'
    ? `Decision framework expert. Recommend the best framework for:

Decision: "${decision}"
Urgency: ${urgency}/5 | Reversibility: ${reversibility}/5 | Complexity: ${complexity}/5 | Options: ${numOptions}

Available: Eisenhower Matrix, OODA Loop, Cynefin Framework, Weighted Decision Matrix, Pre-mortem Analysis, 10/10/10 Rule, Second-Order Thinking, Inversion Method, WRAP Method

Return ONLY valid JSON:
{"framework":"Name","emoji":"emoji","reason":"1-2 sentences why this fits","key_question":"The one question this framework answers best"}`
    : `Expert en frameworks décisionnels. Recommande le meilleur framework pour :

Décision : "${decision}"
Urgence : ${urgency}/5 | Réversibilité : ${reversibility}/5 | Complexité : ${complexity}/5 | Options : ${numOptions}

Disponibles : Matrice Eisenhower, Boucle OODA, Cynefin, Matrice pondérée, Pré-mortem, Règle 10/10/10, Pensée de 2e ordre, Méthode d'inversion, Méthode WRAP

Réponds UNIQUEMENT avec du JSON valide :
{"framework":"Nom","emoji":"emoji","reason":"1-2 phrases pourquoi ce framework convient","key_question":"La question que ce framework aide le mieux à répondre"}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    const text = data?.content?.[0]?.text || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    const framework = match ? JSON.parse(match[0]) : {};
    res.json({ framework });
  } catch (e) {
    res.status(500).json({ error: 'AI error', framework: {} });
  }
});

app.use(express.static(__dirname));

/* ── Session store ── */
const sessions = new Map(); // id → session

const COLORS = ['#2d7d5a', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899'];

function uid(len = 6) {
  return randomBytes(len).toString('hex').slice(0, len).toUpperCase();
}

function createSession(hostId, hostName, anonymous = false) {
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
    weights: {},          // pid → { criterionId: weight(1-5) }
    comments: {},         // pid → { criterionId → [comment per option] }
    ready: {},            // pid → bool (has finished scoring)
    phase: 0,             // 0=options, 1=criteria, 2=scoring, 3=results
    anonymous,            // bool: hide individual scores until phase 3
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
    scores: session.scores,
    weights: session.weights,
    comments: session.comments,
    ready: session.ready,
    phase: session.phase,
    anonymous: session.anonymous
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
        const anonymous = Boolean(msg.anonymous);
        const s = createSession(pid, name, anonymous);
        sid = s.id;
        s.participants[pid]._ws = ws;
        // Init host weights and ready
        s.weights[pid] = {};
        s.comments[pid] = {};
        s.ready[pid] = false;
        s.criteria.forEach(cr => { s.weights[pid][cr.id] = cr.weight || 1; });
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
        // Init scores, weights, comments, ready for existing options/criteria
        s.scores[pid] = {};
        s.weights[pid] = {};
        s.comments[pid] = {};
        s.ready[pid] = false;
        s.criteria.forEach(cr => {
          s.scores[pid][cr.id] = s.options.map(() => 5);
          s.weights[pid][cr.id] = cr.weight || 1;
          s.comments[pid][cr.id] = s.options.map(() => '');
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
        // Extend all participant scores and comments with defaults for the new option
        Object.keys(session.scores).forEach(p => {
          session.criteria.forEach(cr => {
            if (!session.scores[p][cr.id]) session.scores[p][cr.id] = [];
            session.scores[p][cr.id].push(5);
            if (!session.comments[p]) session.comments[p] = {};
            if (!session.comments[p][cr.id]) session.comments[p][cr.id] = [];
            session.comments[p][cr.id].push('');
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
        Object.values(session.comments).forEach(pComments => {
          Object.keys(pComments).forEach(cId => {
            if (Array.isArray(pComments[cId])) pComments[cId].splice(idx, 1);
          });
        });
        syncAll(session);
        break;
      }

      case 'add_criterion': {
        if (!session) return;
        if (session.criteria.find(c => c.id === msg.criterion?.id)) return;
        session.criteria.push(msg.criterion);
        // Init scores, weights, comments for all participants for this new criterion
        Object.keys(session.participants).forEach(p => {
          if (!session.scores[p]) session.scores[p] = {};
          session.scores[p][msg.criterion.id] = session.options.map(() => 5);
          if (!session.weights[p]) session.weights[p] = {};
          session.weights[p][msg.criterion.id] = msg.criterion.weight || 1;
          if (!session.comments[p]) session.comments[p] = {};
          session.comments[p][msg.criterion.id] = session.options.map(() => '');
        });
        syncAll(session);
        break;
      }

      case 'remove_criterion': {
        if (!session) return;
        session.criteria = session.criteria.filter(c => c.id !== msg.criterionId);
        Object.values(session.scores).forEach(pScores => { delete pScores[msg.criterionId]; });
        Object.values(session.weights).forEach(pW => { delete pW[msg.criterionId]; });
        Object.values(session.comments).forEach(pC => { delete pC[msg.criterionId]; });
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

      case 'set_weight': {
        if (!session) return;
        const crId = msg.criterionId;
        const val = Math.max(1, Math.min(5, parseInt(msg.value) || 1));
        if (!session.weights[pid]) session.weights[pid] = {};
        session.weights[pid][crId] = val;
        syncAll(session);
        break;
      }

      case 'set_comment': {
        if (!session) return;
        const crId = msg.criterionId;
        const oi = parseInt(msg.optionIndex);
        const text = String(msg.value || '').slice(0, 200);
        if (!session.comments[pid]) session.comments[pid] = {};
        if (!session.comments[pid][crId]) session.comments[pid][crId] = session.options.map(() => '');
        if (oi >= 0 && oi < session.options.length) session.comments[pid][crId][oi] = text;
        syncAll(session);
        break;
      }

      case 'set_ready': {
        if (!session) return;
        session.ready[pid] = Boolean(msg.value);
        syncAll(session);
        break;
      }

      case 'set_phase': {
        if (!session) return;
        // Only host can change phase
        if (!session.participants[pid]?.isHost) return;
        const newPhase = Math.max(0, Math.min(3, parseInt(msg.value) || 0));
        session.phase = newPhase;
        // Reset ready states when moving to scoring phase
        if (newPhase === 2) {
          Object.keys(session.ready).forEach(p => { session.ready[p] = false; });
        }
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
