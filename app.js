(() => {
  const cfg = window.GAME_NIGHT_CONFIG || {};
  const shared = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_KEY);
  const grid = document.getElementById("grid");
  const sortSel = document.getElementById("sort");
  const errEl = document.getElementById("error");

  // --- per-device storage (wrapped: storage can be blocked) ---
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  let deviceId = store.get("gn_device", null);
  if (!deviceId) {
    deviceId = (crypto.randomUUID ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));
    store.set("gn_device", deviceId);
  }
  let myVotes = store.get("gn_votes", {});      // { gameId: 1 | -1 }
  let localScores = store.get("gn_scores", {}); // device-only mode totals
  sortSel.value = store.get("gn_sort", "score");

  let games = [];
  let scores = {};

  // --- backend ---
  async function rpc(fn, body) {
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.SUPABASE_KEY,
                 Authorization: `Bearer ${cfg.SUPABASE_KEY}` },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) throw new Error(`${fn} failed (${res.status})`);
    return res.json();
  }
  async function loadScores() {
    if (!shared) { scores = { ...localScores }; return; }
    const rows = await rpc("get_scores");
    scores = {}; rows.forEach(r => scores[r.game_id] = r.score);
    // Server is the truth for this device's own votes too.
    const mine = await rpc("get_my_votes", { p_device_id: deviceId });
    myVotes = {}; mine.forEach(r => myVotes[r.game_id] = r.vote);
    store.set("gn_votes", myVotes);
  }
  async function castVote(gameId, vote) {
    if (!shared) {
      const prev = myVotes[gameId] || 0;
      localScores[gameId] = (localScores[gameId] || 0) - prev + vote;
      store.set("gn_scores", localScores);
      scores = { ...localScores };
      return;
    }
    const newScore = await rpc("cast_vote", { p_game_id: gameId, p_device_id: deviceId, p_vote: vote });
    scores[gameId] = newScore;
  }

  // --- rendering ---
  function render() {
    const list = [...games];
    if (sortSel.value === "score") {
      list.sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0) || a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    grid.replaceChildren(...list.map(card));
  }
  function card(g) {
    const s = scores[g.id] || 0, mine = myVotes[g.id] || 0;
    const el = document.createElement("article");
    el.className = "card";
    el.innerHTML = `
      <img alt="" loading="lazy">
      <div class="body">
        <h2></h2>
        <div class="row">
          <button class="vote down" aria-label="Vote down" aria-pressed="${mine === -1}">👎</button>
          <span class="score ${s > 0 ? "pos" : s < 0 ? "neg" : ""}" aria-label="Score">${s > 0 ? "+" + s : s}</span>
          <button class="vote up" aria-label="Vote up" aria-pressed="${mine === 1}">👍</button>
        </div>
      </div>`;
    el.querySelector("img").src = g.image;
    el.querySelector("h2").textContent = g.name;
    el.querySelector(".up").onclick = () => onVote(g.id, 1, el);
    el.querySelector(".down").onclick = () => onVote(g.id, -1, el);
    return el;
  }
  async function onVote(gameId, dir, el) {
    const next = myVotes[gameId] === dir ? 0 : dir; // tap again to undo
    el.querySelectorAll(".vote").forEach(b => b.disabled = true);
    try {
      await castVote(gameId, next);
      if (next === 0) delete myVotes[gameId]; else myVotes[gameId] = next;
      store.set("gn_votes", myVotes);
      errEl.hidden = true;
    } catch (e) {
      showError("Couldn't save your vote. Check your connection and try again.");
    }
    render();
  }
  function showError(msg) { errEl.textContent = msg; errEl.hidden = false; }

  sortSel.onchange = () => { store.set("gn_sort", sortSel.value); render(); };
  document.getElementById("mode").textContent = shared ? "Shared votes" : "Votes saved on this device only";

  // Refresh when coming back to the tab so you see others' votes.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && shared) {
      try { await loadScores(); render(); } catch {}
    }
  });

  (async () => {
    try {
      games = await (await fetch("games.json", { cache: "no-cache" })).json();
    } catch { showError("Couldn't load the game list."); return; }
    try { await loadScores(); } catch { showError("Couldn't load shared scores — showing zeros."); }
    render();
  })();
})();
