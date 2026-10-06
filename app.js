// 2. Angemeldete Teilnehmer auflisten (ohne fehleranfällige DB-Sortierung)
async function loadRegisteredPlayers() {
  const listEl = document.getElementById('registered-players-list');
  const countEl = document.getElementById('player-count');
  if (!listEl) return;

  // Einfache Abfrage ohne created_at Sortierung
  const { data: players, error } = await supabaseClient.from('players').select('*');

  if (error || !players || players.length === 0) {
    listEl.innerHTML = '<p style="color: var(--text-muted);">Noch keine Teilnehmer angemeldet.</p>';
    if (countEl) countEl.innerText = '0';
    return;
  }

  if (countEl) countEl.innerText = players.length;

  let html = '';
  players.forEach(p => {
    html += `
      <div class="player-chip">
        <span>👤 <strong>${p.name}</strong></span>
        <span class="remove-btn" onclick="deletePlayer('${p.id}', '${p.name}')" title="Spieler entfernen">&times;</span>
      </div>`;
  });

  listEl.innerHTML = html;
}
