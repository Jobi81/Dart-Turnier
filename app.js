// Supabase Konfiguration
const SUPABASE_URL = 'https://kivrithhtptvjjotkgzr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpdnJpdGhodHB0dmpqb3RrZ3pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNjgxMjIsImV4cCI6MjEwNjg0NDEyMn0.N86vpqON6XIEYAZjHr7AEd4vJ9DhfG_oDrWRqH8kJdM';

// Supabase Client initialisieren
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Realtime Subscriber einrichten für sofortige Updates auf allen Smartphones
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

// 1. Spieler-Registrierung (Multi-User / Kiosk-fähig)
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
      alert('Fehler beim Eintragen: ' + error.message);
      return;
    }

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

// 4. Live-Rangliste laden & Tiebreaker berechnen (Siege > weniger Restpunkte)
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
        <th>Restpunkte</th>
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

// 5. Ausgewogener Spielplan (Jeder gegen Jeden auf Board 1 & Board 2)
async function generateVorrunde() {
  const { data: players } = await supabaseClient.from('players').select('*');
  if (!players || players.length < 2) {
    alert('Es müssen mindestens 2 Spieler angemeldet sein!');
    return;
  }

  if (!confirm(`Vorrunde mit ${players.length} Spielern starten? Es wird ein optimierter Spielplan auf 2 Boards generiert.`)) {
    return;
  }

  // Zurücksetzen alter Paarungen
  await supabaseClient.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  let pList = [...players];
  if (pList.length % 2 !== 0) {
    pList.push({ id: null, name: 'FREILOS' });
  }

  const numPlayers = pList.length;
  const numRounds = numPlayers - 1;
  const half = numPlayers / 2;

  const rawRounds = [];

  for (let r = 0; r < numRounds; r++) {
    const roundMatches = [];
    for (let i = 0; i < half; i++) {
      const p1 = pList[i];
      const p2 = pList[numPlayers - 1 - i];

      if (p1.id && p2.id) {
        roundMatches.push({
          player1_id: p1.id,
          player2_id: p2.id,
          round_number: r + 1
        });
      }
    }
    rawRounds.push(roundMatches);
    pList.splice(1, 0, pList.pop());
  }

  const newMatches = [];
  let matchCounter = 1;

  rawRounds.forEach(round => {
    round.forEach(m => {
      const boardName = (matchCounter % 2 !== 0) ? 'Board 1' : 'Board 2';

      newMatches.push({
        phase: 'vorrunde',
        round_number: m.round_number,
        player1_id: m.player1_id,
        player2_id: m.player2_id,
        board: boardName,
        is_completed: false
      });

      matchCounter++;
    });
  });

  const { error } = await supabaseClient.from('matches').insert(newMatches);
  if (error) {
    alert('Fehler beim Erstellen der Vorrunde: ' + error.message);
  } else {
    alert(`Vorrunde mit ${newMatches.length} Spielen erfolgreich auf Board 1 & 2 verteilt!`);
    loadMatches();
    loadRanking();
  }
}

// 6. Offene und abgeschlossene Matches laden (mit Grafik-Board & großen Nummern)
async function loadMatches() {
  const listEl = document.getElementById('matches-list');
  if (!listEl) return;

  const { data: matches, error } = await supabaseClient
    .from('matches')
    .select('*, p1:player1_id(name), p2:player2_id(name)');

  if (error || !matches || matches.length === 0) {
    listEl.innerHTML = '<p style="color: var(--text-muted);">Aktuell sind keine Spielpaarungen aktiv.</p>';
    return;
  }

  // Offene Matches zuerst anzeigen, beendete nach unten
  matches.sort((a, b) => (a.is_completed === b.is_completed) ? 0 : a.is_completed ? 1 : -1);

  // SVG-Dartboard als Data-URI
  const dartboardSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="%230b0f19" stroke="%23334155" stroke-width="2"/><circle cx="50" cy="50" r="40" fill="none" stroke="%2322c55e" stroke-width="3"/><circle cx="50" cy="50" r="28" fill="none" stroke="%23ef4444" stroke-width="3"/><circle cx="50" cy="50" r="14" fill="%2322c55e"/><circle cx="50" cy="50" r="6" fill="%23ef4444"/></svg>`;

  let html = '';
  matches.forEach(m => {
    const p1Name = m.p1 ? m.p1.name : 'Spieler 1';
    const p2Name = m.p2 ? m.p2.name : 'Spieler 2';
    const phaseTitle = m.phase.toUpperCase();
    const isBoard2 = (m.board === 'Board 2');
    const boardNum = isBoard2 ? '2' : '1';
    const boardClass = isBoard2 ? 'board-2' : 'board-1';

    if (m.is_completed) {
      // BEENDETES MATCH
      const winnerName = m.winner_id === m.player1_id ? p1Name : p2Name;
      html += `
        <div class="match-card completed">
          <div class="board-badge-container">
            <img src="${dartboardSvg}" class="dartboard-img" alt="Dartboard">
            <div class="board-number-overlay ${boardClass}">${boardNum}</div>
          </div>

          <div class="match-content">
            <div class="match-header-info">
              <span>${phaseTitle} — Runde ${m.round_number || 1}</span>
              <button onclick="reopenMatch('${m.id}')" style="width: auto; padding: 0.2rem 0.6rem; font-size: 0.8rem; background: #475569; color: #fff;" title="Ergebnis korrigieren">
                ✏️ Bearbeiten
              </button>
            </div>

            <div class="vs-grid">
              <div class="player-title">${p1Name}</div>
              <div class="vs-divider">VS</div>
              <div class="player-title">${p2Name}</div>
            </div>

            <div style="font-size: 0.9rem; color: var(--accent); margin-top: 0.4rem; text-align: center; background: #0b0f19; padding: 0.4rem; border-radius: 6px;">
              🏆 Sieger: <strong>${winnerName}</strong> (Restpunkte: ${m.p1_rest_points || 0} : ${m.p2_rest_points || 0})
            </div>
          </div>
        </div>`;
    } else {
      // OFFENES MATCH
      html += `
        <div class="match-card">
          <div class="board-badge-container">
            <img src="${dartboardSvg}" class="dartboard-img" alt="Dartboard">
            <div class="board-number-overlay ${boardClass}">${boardNum}</div>
          </div>

          <div class="match-content">
            <div class="match-header-info">
              <span>${phaseTitle} — Runde ${m.round_number || 1}</span>
            </div>

            <div class="vs-grid">
              <div class="player-title">${p1Name}</div>
              <div class="vs-divider">VS</div>
              <div class="player-title">${p2Name}</div>
            </div>

            <div class="match-inputs-grid">
              <div>
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; text-align: center; margin-bottom: 0.2rem;">Restpunkte ${p1Name}</label>
                <input type="number" id="rest_p1_${m.id}" placeholder="0 (Gewinner = 0)" min="0" style="text-align: center; font-weight: bold;">
              </div>
              <div>
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; text-align: center; margin-bottom: 0.2rem;">Restpunkte ${p2Name}</label>
                <input type="number" id="rest_p2_${m.id}" placeholder="0 (Gewinner = 0)" min="0" style="text-align: center; font-weight: bold;">
              </div>
            </div>

            <button onclick="submitResult('${m.id}', '${m.player1_id}', '${m.player2_id}')" style="margin-top: 0.6rem;">
              Ergebnis Speichern
            </button>
          </div>
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
    is_completed: true
  }).eq('id', matchId);

  if (error) {
    alert('Fehler beim Speichern: ' + error.message);
  } else {
    loadRanking();
    loadMatches();
  }
}

// 8. Ergebnis zur Korrektur wieder freischalten (✏️️ Edit-Button)
async function reopenMatch(matchId) {
  const { error } = await supabaseClient.from('matches').update({
    is_completed: false,
    winner_id: null
  }).eq('id', matchId);

  if (error) {
    alert('Fehler beim Freischalten: ' + error.message);
  } else {
    loadRanking();
    loadMatches();
  }
}

// Initialer Aufruf beim Seitenstart
document.addEventListener('DOMContentLoaded', () => {
  loadRegisteredPlayers();
  loadRanking();
  loadMatches();
});
