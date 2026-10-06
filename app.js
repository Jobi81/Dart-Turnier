// Supabase Konfiguration
const SUPABASE_URL = 'https://kivrithhtptvjjotkgzr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpdnJpdGhodHB0dmpqb3RrZ3pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNjgxMjIsImV4cCI6MjEwNjg0NDEyMn0.N86vpqON6XIEYAZjHr7AEd4vJ9DhfG_oDrWRqH8kJdM';

// Supabase Client initialisieren
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Realtime Subscriber einrichten
supabaseClient
  .channel('turnier_updates')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
    loadRanking();
    loadMatches();
  })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
    loadRegisteredPlayers();
    loadRanking();
    loadMatches();
  })
  .subscribe();

// 1. Spieler-Registrierung (Multi-User-fähig auf einem Gerät)
async function registerPlayer() {
  const inputEl = document.getElementById('player-name-input');
  if (!inputEl) return;
  
  const nameInput = inputEl.value.trim();
  if (!nameInput) {
    alert('Bitte gib einen Namen ein!');
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('players')
      .insert([{ name: nameInput }])
      .select();

    if (error) {
      alert('Fehler oder Name bereits eingetragen: ' + error.message);
      return;
    }

    // Eingabefeld leeren für den nächsten Teilnehmer
    inputEl.value = '';
    inputEl.focus();

    loadRegisteredPlayers();
    loadRanking();

  } catch (err) {
    console.error('Fehler bei der Anmeldung:', err);
    alert('Verbindungsfehler: ' + err.message);
  }
}

// 2. Angemeldete Teilnehmer auflisten
async function loadRegisteredPlayers() {
  const listEl = document.getElementById('registered-players-list');
  const countEl = document.getElementById('player-count');
  if (!listEl) return;

  const { data: players, error } = await supabaseClient.from('players').select('*').order('created_at', { ascending: true });

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

// 3. Teilnehmer löschen
async function deletePlayer(playerId, playerName) {
  if (!confirm(`Möchtest du "${playerName}" wirklich aus der Teilnehmerliste entfernen?`)) {
    return;
  }

  const { error } = await supabaseClient.from('players').delete().eq('id', playerId);
  if (error) {
    alert('Fehler beim Löschen: ' + error.message);
  } else {
    loadRegisteredPlayers();
    loadRanking();
  }
}

// 4. Live-Rangliste laden & Tiebreaker berechnen
async function loadRanking() {
  const rankingEl = document.getElementById('ranking-table');
  if (!rankingEl) return;

  const { data: players, error: pErr } = await supabaseClient.from('players').select('*');
  const { data: matches, error: mErr } = await supabaseClient.from('matches').select('*').eq('is_completed', true);

  if (pErr || !players || players.length === 0) {
    rankingEl.innerHTML = '<p style="color: var(--text-muted);">Noch keine Punkte vorhanden.</p>';
    return;
  }

  const stats = players.map(p => {
    let points = 0;
    let restPoints = 0;
    let played = 0;

    matches?.forEach(m => {
      if (m.player1_id === p.id) {
        played++;
        if (m.winner_id === p.id) points += 1;
        else restPoints += (m.p1_rest_points || 0);
      } else if (m.player2_id === p.id) {
        played++;
        if (m.winner_id === p.id) points += 1;
        else restPoints += (m.p2_rest_points || 0);
      }
    });

    return { id: p.id, name: p.name, points, restPoints, played };
  });

  stats.sort((a, b) => b.points - a.points || a.restPoints - b.restPoints);

  let html = `<table class="table">
    <thead>
      <tr>
        <th>#</th>
        <th>Spieler</th>
        <th>Spiele</th>
        <th>Siege</th>
        <th>Rest-Pkt</th>
      </tr>
    </thead>
    <tbody>`;

  stats.forEach((s, i) => {
    html += `<tr>
      <td><strong>${i + 1}</strong></td>
      <td>${s.name}</td>
      <td>${s.played}</td>
      <td><strong style="color: var(--accent);">${s.points}</strong></td>
      <td>${s.restPoints}</td>
    </tr>`;
  });

  html += `</tbody></table>`;
  rankingEl.innerHTML = html;
}

// 5. Vorrunde generieren (Jeder gegen Jeden - 301 Single Out)
async function generateVorrunde() {
  const { data: players } = await supabaseClient.from('players').select('*');
  if (!players || players.length < 2) {
    alert('Es müssen mindestens 2 Spieler angemeldet sein!');
    return;
  }

  if (!confirm(`Vorrunde mit ${players.length} Spielern starten? Es werden alle Duelle generiert.`)) {
    return;
  }

  await supabaseClient.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const newMatches = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      newMatches.push({
        phase: 'vorrunde',
        player1_id: players[i].id,
        player2_id: players[j].id,
        is_completed: false
      });
    }
  }

  const { error } = await supabaseClient.from('matches').insert(newMatches);
  if (error) {
    alert('Fehler beim Erstellen der Vorrunde: ' + error.message);
  } else {
    alert(`Vorrunde mit ${newMatches.length} Spielen erfolgreich gestartet!`);
    loadMatches();
    loadRanking();
  }
}

// 6. Offene und abgeschlossene Matches laden
async function loadMatches() {
  const listEl = document.getElementById('matches-list');
  if (!listEl) return;

  const { data: matches, error } = await supabaseClient
    .from('matches')
    .select('*, p1:player1_id(name), p2:player2_id(name)')
    .order('updated_at', { ascending: false });

  if (error || !matches || matches.length === 0) {
    listEl.innerHTML = '<p style="color: var(--text-muted);">Aktuell sind keine Spielpaarungen aktiv.</p>';
    return;
  }

  let html = '';
  matches.forEach(m => {
    const p1Name = m.p1 ? m.p1.name : 'Spieler 1';
    const p2Name = m.p2 ? m.p2.name : 'Spieler 2';
    const phaseTitle = m.phase.toUpperCase();

    if (m.is_completed) {
      const winnerName = m.winner_id === m.player1_id ? p1Name : p2Name;
      html += `
        <div class="match-card" style="opacity: 0.7; border-color: #1e293b;">
          <div class="match-header">
            <span class="phase-badge">${phaseTitle}</span> — Beendet
          </div>
          <div><strong>${p1Name}</strong> vs <strong>${p2Name}</strong></div>
          <div style="font-size: 0.85rem; color: var(--accent); margin-top: 0.3rem;">
            🏆 Sieger: ${winnerName} | Restpunkte: ${m.p1_rest_points || 0} : ${m.p2_rest_points || 0}
          </div>
        </div>`;
    } else {
      html += `
        <div class="match-card">
          <div class="match-header">
            <span class="phase-badge" style="background: var(--accent); color: #000;">${phaseTitle}</span>
          </div>
          <div style="margin-bottom: 0.75rem; font-size: 1.1rem;">
            <strong>${p1Name}</strong> <span style="color: var(--text-muted);">vs</span> <strong>${p2Name}</strong>
          </div>
          
          <div class="match-inputs">
            <div>
              <label style="font-size: 0.8rem; color: var(--text-muted);">${p1Name} Restpkt:</label>
              <input type="number" id="rest_p1_${m.id}" placeholder="0 (Gewinner = 0)" min="0">
            </div>
            <div>
              <label style="font-size: 0.8rem; color: var(--text-muted);">${p2Name} Restpkt:</label>
              <input type="number" id="rest_p2_${m.id}" placeholder="0 (Gewinner = 0)" min="0">
            </div>
          </div>

          <button onclick="submitResult('${m.id}', '${m.player1_id}', '${m.player2_id}')" style="margin-top: 0.5rem;">
            Ergebnis Speichern
          </button>
        </div>`;
    }
  });

  listEl.innerHTML = html;
}

// 7. Ergebnis eintragen
async function submitResult(matchId, p1Id, p2Id) {
  const p1RestInput = document.getElementById(`rest_p1_${matchId}`);
  const p2RestInput = document.getElementById(`rest_p2_${matchId}`);

  const p1Rest = parseInt(p1RestInput.value, 10);
  const p2Rest = parseInt(p2RestInput.value, 10);

  if (isNaN(p1Rest) || isNaN(p2Rest)) {
    alert('Bitte gib für beide Spieler die verbliebenen Restpunkte ein (Gewinner = 0)!');
    return;
  }

  if (p1Rest !== 0 && p2Rest !== 0) {
    alert('Der Gewinner muss genau 0 Restpunkte haben!');
    return;
  }

  if (p1Rest === 0 && p2Rest === 0) {
    alert('Es kann nur einen Gewinner mit 0 Restpunkten geben!');
    return;
  }

  const winnerId = p1Rest === 0 ? p1Id : p2Id;

  const { error } = await supabaseClient.from('matches').update({
    winner_id: winnerId,
    p1_rest_points: p1Rest,
    p2_rest_points: p2Rest,
    is_completed: true,
    updated_at: new Date()
  }).eq('id', matchId);

  if (error) {
    alert('Fehler beim Speichern: ' + error.message);
  } else {
    loadRanking();
    loadMatches();
  }
}

// Initialer Aufruf beim Laden der Seite
document.addEventListener('DOMContentLoaded', () => {
  loadRegisteredPlayers();
  loadRanking();
  loadMatches();
});
