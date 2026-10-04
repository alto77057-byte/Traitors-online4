import { getStore } from "@netlify/blobs";

const NIGHT = 60000, DAWN = 20000, VOTE = 120000, RESULT = 15000;
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rid = (n, A = "abcdefghijklmnopqrstuvwxyz0123456789") => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => A[b % A.length]).join("");
const tcount = n => Math.max(1, Math.floor((n + 2) / 4));
const clean = s => String(s || "").trim().slice(0, 14);
const al = g => g.players.filter(p => p.alive);
const by = (g, id) => g.players.find(p => p.id === id);
const mkp = name => ({ id: rid(6), key: rid(16), name, alive: true, role: null, seen: Date.now() });

function win(g) {
  const a = al(g), t = a.filter(p => p.role === "T").length;
  const w = t === 0 ? "F" : t >= a.length - t ? "T" : null;
  if (w) { g.winner = w; g.phase = "end"; g.deadline = 0; }
}
function night(g) {
  const c = {};
  Object.values(g.picks).forEach(id => (c[id] = (c[id] || 0) + 1));
  const m = Math.max(0, ...Object.values(c)), top = Object.keys(c).filter(k => c[k] === m);
  if (!top.length) g.msg = "The night passes. No one was murdered.";
  else { const v = by(g, top[Math.floor(Math.random() * top.length)]); v.alive = false; g.msg = v.name + " was murdered in the night. They were Innocent."; }
  g.phase = "dawn"; g.deadline = Date.now() + DAWN;
  g.log.push("Night " + g.round + ": " + g.msg); win(g);
}
function openVote(g) { g.phase = "vote"; g.votes = {}; g.deadline = Date.now() + VOTE; }
function tally(g) {
  const c = {};
  Object.values(g.votes).forEach(id => (c[id] = (c[id] || 0) + 1));
  const rows = Object.keys(c).map(id => ({ id, name: by(g, id).name, n: c[id] })).sort((a, b) => b.n - a.n);
  g.tally = rows; g.phase = "result"; g.deadline = Date.now() + RESULT;
  if (!rows.length || (rows[1] && rows[1].n === rows[0].n)) g.msg = "The vote was tied. No one is banished.";
  else { const v = by(g, rows[0].id); v.alive = false; g.msg = v.name + " was banished. They were " + (v.role === "T" ? "a Traitor" : "Innocent") + "."; }
  g.log.push("Day " + g.round + ": " + g.msg); win(g);
}
function nextNight(g) { g.round++; g.phase = "night"; g.picks = {}; g.msg = ""; g.tally = null; g.deadline = Date.now() + NIGHT; }
function start(g) {
  const ps = g.players, ids = ps.map((_, i) => i);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  ps.forEach(p => { p.role = "F"; p.alive = true; });
  ids.slice(0, tcount(ps.length)).forEach(i => (ps[i].role = "T"));
  Object.assign(g, { phase: "night", round: 1, picks: {}, votes: {}, msg: "", tally: null, winner: null, log: [], deadline: Date.now() + NIGHT });
}
function tick(g, now) {
  if (!g.deadline || now < g.deadline) return false;
  if (g.phase === "night") night(g);
  else if (g.phase === "dawn") openVote(g);
  else if (g.phase === "vote") tally(g);
  else if (g.phase === "result") nextNight(g);
  else g.deadline = 0;
  return true;
}
function act(g, p, m) {
  const h = g.phase, host = p.id === g.hostId, a = al(g);
  if (m.t === "start") {
    if (!host || h !== "lobby") return "Only the host can start the game.";
    if (g.players.length < 4) return "You need at least 4 players.";
    start(g);
  } else if (m.t === "pick") {
    if (h !== "night" || !p.alive || p.role !== "T") return "You can't do that now.";
    const t = by(g, m.target);
    if (!t || !t.alive || t.role === "T") return "Invalid choice.";
    g.picks[p.id] = t.id;
    if (Object.keys(g.picks).length >= a.filter(q => q.role === "T").length) night(g);
  } else if (m.t === "vote") {
    if (h !== "vote" || !p.alive) return "You can't vote now.";
    const t = by(g, m.target);
    if (!t || !t.alive || t === p) return "Invalid vote.";
    g.votes[p.id] = t.id;
    if (Object.keys(g.votes).length >= a.length) tally(g);
  } else if (m.t === "force") {
    if (!host) return "Only the host can do that.";
    if (h === "night") night(g); else if (h === "vote") tally(g);
  } else if (m.t === "next") {
    if (!host) return "Only the host can do that.";
    if (h === "dawn") openVote(g); else if (h === "result") nextNight(g);
  } else if (m.t === "again") {
    if (!host || h !== "end") return "Only the host can do that.";
    g.players.forEach(q => { q.alive = true; q.role = null; });
    Object.assign(g, { phase: "lobby", round: 0, picks: {}, votes: {}, msg: "", tally: null, winner: null, log: [], deadline: 0 });
  }
  return null;
}
function view(g, p, now) {
  const end = g.phase === "end", T = p.role === "T", a = al(g), night = g.phase === "night";
  return {
    n: g.n || 0, code: g.code, phase: g.phase, round: g.round, msg: g.msg, log: g.log, tally: g.tally, winner: g.winner,
    host: p.id === g.hostId, me: p.id, role: p.role, alive: p.alive,
    players: g.players.map(q => ({ id: q.id, name: q.name, alive: q.alive, online: now - q.seen < 15000,
      role: end || !q.alive || (T && q.role === "T") ? q.role : null })),
    pickDone: g.picks[p.id] != null, voteDone: g.votes[p.id] != null,
    got: Object.keys(night ? g.picks : g.votes).length,
    need: night ? a.filter(q => q.role === "T").length : a.length,
    rem: g.deadline ? Math.max(0, g.deadline - now) : 0,
  };
}
async function mutate(st, code, now, fn) {
  for (let i = 0; i < 8; i++) {
    const r = await st.getWithMetadata(code, { type: "json" });
    if (!r) return { err: "No game with that code.", fatal: true };
    const g = r.data, ticked = tick(g, now), out = fn(g);
    if (out.err) return out;
    if (!(out.write || ticked)) { out.view = view(g, out.p, now); return out; }
    g.n = (g.n || 0) + 1;
    out.view = view(g, out.p, now);
    const w = await st.setJSON(code, g, { onlyIfMatch: r.etag });
    if (w.modified) return out;
  }
  return { err: "The server is busy. Try again." };
}

export default async (req) => {
  if (req.method !== "POST") return J({ err: "POST only" }, 405);
  let m;
  try { m = await req.json(); } catch { return J({ err: "Bad request" }, 400); }
  const st = getStore({ name: "traitors", consistency: "strong" }), now = Date.now();
  const code = String(m.code || "").toUpperCase().slice(0, 4);
  try {
    if (m.a === "create") {
      const name = clean(m.name);
      if (!name) return J({ err: "Enter your name." });
      for (let i = 0; i < 6; i++) {
        const c = rid(4, "ABCDEFGHJKMNPQRSTUVWXYZ"), p = mkp(name);
        const g = { n: 0, code: c, hostId: p.id, players: [p], phase: "lobby", round: 0, picks: {}, votes: {}, msg: "", tally: null, winner: null, log: [], deadline: 0 };
        const w = await st.setJSON(c, g, { onlyIfNew: true });
        if (w.modified) return J({ code: c, pid: p.id, key: p.key, view: view(g, p, now) });
      }
      return J({ err: "Could not create a game. Try again." });
    }
    if (m.a === "join") {
      const name = clean(m.name);
      if (!name) return J({ err: "Enter your name." });
      const out = await mutate(st, code, now, g => {
        let p = g.players.find(q => q.name.toLowerCase() === name.toLowerCase());
        if (p) {
          if (now - p.seen < 15000) return { err: "That name is taken." };
          p.key = rid(16); p.seen = now;
        } else {
          if (g.phase !== "lobby") return { err: "The game has already started." };
          if (g.players.length >= 14) return { err: "The table is full." };
          p = mkp(name); g.players.push(p);
        }
        return { write: true, p };
      });
      if (out.err) return J({ err: out.err });
      return J({ code, pid: out.p.id, key: out.p.key, view: out.view });
    }
    if (m.a === "poll" || m.a === "act") {
      const out = await mutate(st, code, now, g => {
        const p = g.players.find(q => q.id === m.pid && q.key === m.key);
        if (!p) return { err: "Your session ended. Reload and join again.", fatal: true };
        let write = false;
        if (m.a === "act") { const e = act(g, p, m); if (e) return { err: e }; write = true; }
        if (now - p.seen > 10000) { p.seen = now; write = true; }
        return { write, p };
      });
      if (out.err) return J({ err: out.err, fatal: !!out.fatal });
      return J({ view: out.view });
    }
  } catch (e) {
    return J({ err: "Server error. Try again." }, 500);
  }
  return J({ err: "Unknown request" }, 400);
};
