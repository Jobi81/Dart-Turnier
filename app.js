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

// Helper: Generiert einen Round-Robin Spielplan (Jeder gegen Jeden)
function buildRoundRobin(playerList) {
  let pList = [...playerList];
  if (pList.length % 2 !== 0) {
    pList.push({ id: null, name: 'FREILOS' });
  }

  const numPlayers = pList.length;
  const numRounds = numPlayers - 1;
  const half = numPlayers / 2;
  const rounds = [];

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
    rounds.push(roundMatches);
    pList.splice(1, 0, pList.pop());
  }
  return rounds;
}

// 1. Spieler-Registrierung
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

// 4. Live-Rangliste laden (Behält Gruppen-Tabellen auch in Phase 3 & 4 bei)
async function loadRanking() {
  const rankingEl = document.getElementById('ranking-table');
  if (!rankingEl) return;

  const { data: players, error: pErr } = await supabaseClient.from('players').select('*');
  const { data: allMatches, error: mErr } = await supabaseClient.from('matches').select('*, p1:player1_id(name), p2:player2_id(name)');

  if (pErr || !players || players.length === 0) {
    rankingEl.innerHTML = '<p style="color: var(--text-muted);">Noch keine Punkte vorhanden.</p>';
    return;
  }

  const completedMatches = allMatches?.filter(m => m.is_completed) || [];
  const phasesInDb = [...new Set(allMatches?.map(m => m.phase) || [])];

  const hasGroupPhase = phasesInDb.includes('gruppe_a') || phasesInDb.includes('gruppe_b') || phasesInDb.includes('zwischenrunde') || phasesInDb.includes('finale') || phasesInDb.includes('platz_3');

  if (hasGroupPhase) {
    // --- GRUPPENPHASE TABELLEN (Bleiben auch ab Zwischenrunde sichtbar) ---
    const groupAMatches = allMatches.filter(m => m.phase === 'gruppe_a');
    const groupBMatches = allMatches.filter(m => m.phase === 'gruppe_b');

    const playerIdsA = [...new Set(groupAMatches.flatMap(m => [m.player1_id, m.player2_id]))];
    const playerIdsB = [...new Set(groupBMatches.flatMap(m => [m.player1_id, m.player2_id]))];

    function buildTableHTML(phaseName, title, allowedPlayerIds) {
      const phaseCompletedMatches = completedMatches.filter(m => m.phase === phaseName);
      const targetPlayers = players.filter(p => allowedPlayerIds.includes(p.id));

      const stats = targetPlayers.map(p => {
        let points = 0;
        let restPoints = 0;
        let played = 0;

        phaseCompletedMatches.forEach(m => {
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

      let html = `<div class="group-box">
        <h4 style="color: var(--accent); margin: 0 0 0.5rem 0;">${title}</h4>
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Spieler</th>
              <th>Sp.</th>
              <th>Siege</th>
              <th>Restp.</th>
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

      html += `</tbody></table></div>`;
      return html;
    }

    let html = `<div class="groups-container-grid">`;
    html += buildTableHTML('gruppe_a', 'Gruppe A Rangliste', playerIdsA);
    html += buildTableHTML('gruppe_b', 'Gruppe B Rangliste', playerIdsB);
    html += `</div>`;
    rankingEl.innerHTML = html;

  } else {
    // --- VORRUNDE TABELLE ---
    const phaseCompletedMatches = completedMatches.filter(m => m.phase === 'vorrunde');
    const stats = players.map(p => {
      let points = 0;
      let restPoints = 0;
      let played = 0;

      phaseCompletedMatches.forEach(m => {
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

    let html = `<div class="group-box">
      <h4 style="color: var(--accent); margin: 0 0 0.5rem 0;">Vorrunde Live-Rangliste</h4>
      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Spieler</th>
            <th>Sp.</th>
            <th>Siege</th>
            <th>Restp.</th>
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

    html += `</tbody></table></div>`;
    rankingEl.innerHTML = html;
  }
}

// 5. STUFE 1: Vorrunde generieren
async function generateVorrunde() {
  const { data: players } = await supabaseClient.from('players').select('*');
  if (!players || players.length < 2) {
    alert('Es müssen mindestens 2 Spieler angemeldet sein!');
    return;
  }

  if (!confirm(`Vorrunde mit ${players.length} Spielern starten? Es wird ein optimierter Spielplan auf 2 Boards generiert.`)) {
    return;
  }

  await supabaseClient.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const rawRounds = buildRoundRobin(players);
  const newMatches = [];
  let matchCounter = 1;

  rawRounds.forEach(round => {
    round.forEach(m => {
      newMatches.push({
        phase: 'vorrunde',
        round_number: m.round_number,
        player1_id: m.player1_id,
        player2_id: m.player2_id,
        board: (matchCounter % 2 !== 0) ? 'Board 1' : 'Board 2',
        is_completed: false
      });
      matchCounter++;
    });
  });

  const { error } = await supabaseClient.from('matches').insert(newMatches);
  if (error) {
    alert('Fehler beim Erstellen der Vorrunde: ' + error.message);
  } else {
    alert(`Vorrunde mit ${newMatches.length} Spielen erfolgreich gestartet!`);
    loadMatches();
    loadRanking();
  }
}

// Helper: Berechnet Rangliste einer Phase
async function getPhaseStats(phaseName) {
  const { data: players } = await supabaseClient.from('players').select('*');
  const { data: phaseMatches } = await supabaseClient.from('matches').select('*').eq('phase', phaseName).eq('is_completed', true);

  const stats = players.map(p => {
    let points = 0;
    let restPoints = 0;

    phaseMatches?.forEach(m => {
      if (m.player1_id === p.id) {
        if (m.winner_id === p.id) points += 1;
        else restPoints += (m.p1_rest_points || 0);
      } else if (m.player2_id === p.id) {
        if (m.winner_id === p.id) points += 1;
        else restPoints += (m.p2_rest_points || 0);
      }
    });

    return { id: p.id, name: p.name, points, restPoints };
  });

  return stats.sort((a, b) => b.points - a.points || a.restPoints - b.restPoints);
}

// 6. STUFE 2: Gruppenphase A & B (Gleichzeitiger Ablauf & ausgewogene Boards)
async function generateGruppenphase() {
  const stats = await getPhaseStats('vorrunde');

  const gruppeA = [];
  const gruppeB = [];

  stats.forEach((p, index) => {
    if (index % 2 === 0) gruppeA.push(p);
    else gruppeB.push(p);
  });

  if (!confirm(`Gruppenphase A & B starten?\n\nGruppe A (${gruppeA.length} Spieler):\n${gruppeA.map((g,i)=>`${i+1}.${g.name}`).join('\n')}\n\nGruppe B (${gruppeB.length} Spieler):\n${gruppeB.map((g,i)=>`${i+1}.${g.name}`).join('\n')}`)) {
    return;
  }

  const roundsA = buildRoundRobin(gruppeA);
  const roundsB = buildRoundRobin(gruppeB);

  const newMatches = [];
  let matchCounter = 1;
  const maxRounds = Math.max(roundsA.length, roundsB.length);

  for (let r = 0; r < maxRounds; r++) {
    if (roundsA[r]) {
      roundsA[r].forEach(m => {
        newMatches.push({
          phase: 'gruppe_a',
          round_number: r + 1,
          player1_id: m.player1_id,
          player2_id: m.player2_id,
          board: (matchCounter % 2 !== 0) ? 'Board 1' : 'Board 2',
          is_completed: false
        });
        matchCounter++;
      });
    }

    if (roundsB[r]) {
      roundsB[r].forEach(m => {
        newMatches.push({
          phase: 'gruppe_b',
          round_number: r + 1,
          player1_id: m.player1_id,
          player2_id: m.player2_id,
          board: (matchCounter % 2 !== 0) ? 'Board 1' : 'Board 2',
          is_completed: false
        });
        matchCounter++;
      });
    }
  }

  const { error } = await supabaseClient.from('matches').insert(newMatches);
  if (error) {
    alert('Fehler beim Erstellen der Gruppenphase: ' + error.message);
  } else {
    alert(`Gruppenphase erfolgreich gestartet! Beide Gruppen spielen ab sofort parallel.`);
    loadMatches();
    loadRanking();
  }
}

// 7. STUFE 3: Zwischenrunde (Exakt 1 Überkreuz-Match pro Spieler, Best of 3)
async function generateZwischenrunde() {
  const statsA = await getPhaseStats('gruppe_a');
  const statsB = await getPhaseStats('gruppe_b');

  if (statsA.length === 0 || statsB.length === 0) {
    alert('Fehler beim Auslesen der Gruppenergebnisse!');
    return;
  }

  if (!confirm(`Zwischenrunde (Überkreuz-Duelle Best of 3) jetzt starten?`)) {
    return;
  }

  // Alte Zwischenrunden-Spiele vorher gründlich entfernen
  await supabaseClient.from('matches').delete().eq('phase', 'zwischenrunde');

  const crossPairs = [];
  const len = Math.min(statsA.length, statsB.length);

  // KORREKTE ÜBERKREUZ-LOGIK:
  // Wir paarweisen immer 2 Ränge miteinander (0&1, 2&3, 4&5...)
  // Paar 1: 1. A (index 0) vs 2. B (index 1) UND 1. B (index 0) vs 2. A (index 1)
  // Paar 2: 3. A (index 2) vs 4. B (index 3) UND 3. B (index 2) vs 4. A (index 3)
  for (let i = 0; i < len; i += 2) {
    if (statsA[i] && statsB[i + 1]) {
      crossPairs.push({ p1: statsA[i], p2: statsB[i + 1] });
    }
    if (statsB[i] && statsA[i + 1]) {
      crossPairs.push({ p1: statsB[i], p2: statsA[i + 1] });
    }
  }

  const newMatches = [];
  let matchCounter = 1;

  // Jede Paarung wird exakt EINMAL als Best-of-3 angelegt
  crossPairs.forEach(pair => {
    newMatches.push({
      phase: 'zwischenrunde',
      round_number: 1,
      player1_id: pair.p1.id,
      player2_id: pair.p2.id,
      board: (matchCounter % 2 !== 0) ? 'Board 1' : 'Board 2',
      is_completed: false
    });
    matchCounter++;
  });

  const { error } = await supabaseClient.from('matches').insert(newMatches);
  if (error) {
    alert('Fehler beim Erstellen der Zwischenrunde: ' + error.message);
  } else {
    alert(`Zwischenrunde mit genau ${newMatches.length} Überkreuz-Duellen gestartet!`);
    loadMatches();
    loadRanking();
  }
}

// 8. STUFE 4: Finals & Platzierungsspiele generieren
async function generateFinals() {
  const { data: zwMatches } = await supabaseClient.from('matches').select('*, p1:player1_id(name), p2:player2_id(name)').eq('phase', 'zwischenrunde').eq('is_completed', true);

  if (!zwMatches || zwMatches.length === 0) {
    alert('Keine Ergebnisse der Zwischenrunde vorhanden!');
    return;
  }

  if (!confirm(`Finals & Platzierungsspiele jetzt starten?`)) {
    return;
  }

  // Alte Finalspiele löschen, falls bereits vorhanden
  await supabaseClient.from('matches').delete().in('phase', ['finale', 'platz_3']);

  const winners = zwMatches.map(m => m.winner_id);
  const losers = zwMatches.map(m => m.winner_id === m.player1_id ? m.player2_id : m.player1_id);

  const newMatches = [];

  if (winners.length >= 2) {
    newMatches.push({
      phase: 'finale',
      round_number: 1,
      player1_id: winners[0],
      player2_id: winners[1],
      board: 'Board 1',
      is_completed: false
    });
  }

  if (losers.length >= 2) {
    newMatches.push({
      phase: 'platz_3',
      round_number: 1,
      player1_id: losers[0],
      player2_id: losers[1],
      board: 'Board 2',
      is_completed: false
    });
  }

  const { error } = await supabaseClient.from('matches').insert(newMatches);
  if (error) {
    alert('Fehler beim Erstellen der Finals: ' + error.message);
  } else {
    alert(`Finalspiele erfolgreich generiert!`);
    loadMatches();
    loadRanking();
  }
}

// 9. Offene und abgeschlossene Matches laden
async function loadMatches() {
  const listEl = document.getElementById('matches-list');
  if (!listEl) return;

  const { data: matches, error } = await supabaseClient
    .from('matches')
    .select('*, p1:player1_id(name), p2:player2_id(name)');

  if (error || !matches) {
    listEl.innerHTML = '<p style="color: var(--text-muted);">Fehler beim Laden der Duelle.</p>';
    return;
  }

  // FREISCHALTUNGS-LOGIK FÜR ADMIN-BUTTONS
  const btnGruppe = document.getElementById('btn-gruppe');
  const btnZwischenrunde = document.getElementById('btn-zwischenrunde');
  const btnFinals = document.getElementById('btn-finals');
  const statusHint = document.getElementById('admin-status-hint');

  const vorrundeMatches = matches.filter(m => m.phase === 'vorrunde');
  const gruppenMatches = matches.filter(m => m.phase === 'gruppe_a' || m.phase === 'gruppe_b');
  const zwischenrundeMatches = matches.filter(m => m.phase === 'zwischenrunde');

  const vorrundeDone = vorrundeMatches.length > 0 && vorrundeMatches.every(m => m.is_completed);
  const gruppeDone = gruppenMatches.length > 0 && gruppenMatches.every(m => m.is_completed);
  const zwischenrundeDone = zwischenrundeMatches.length > 0 && zwischenrundeMatches.every(m => m.is_completed);

  if (btnGruppe) btnGruppe.disabled = !vorrundeDone;
  if (btnZwischenrunde) btnZwischenrunde.disabled = !gruppeDone;
  if (btnFinals) btnFinals.disabled = !zwischenrundeDone;

  if (statusHint) {
    if (!vorrundeDone && vorrundeMatches.length > 0) {
      const openCount = vorrundeMatches.filter(m => !m.is_completed).length;
      statusHint.innerText = `Vorrunde läuft noch (${openCount} offene Spiele).`;
    } else if (vorrundeDone && gruppenMatches.length === 0) {
      statusHint.innerText = `Vorrunde beendet! Bereit für Schritt 2 (Gruppenphase).`;
    } else if (!gruppeDone && gruppenMatches.length > 0) {
      const openCount = gruppenMatches.filter(m => !m.is_completed).length;
      statusHint.innerText = `Gruppenphase läuft noch (${openCount} offene Spiele).`;
    } else if (gruppeDone && zwischenrundeMatches.length === 0) {
      statusHint.innerText = `Gruppenphase beendet! Bereit für Schritt 3 (Zwischenrunde).`;
    } else if (!zwischenrundeDone && zwischenrundeMatches.length > 0) {
      statusHint.innerText = `Zwischenrunde läuft noch.`;
    } else if (zwischenrundeDone) {
      statusHint.innerText = `Zwischenrunde beendet! Bereit für Schritt 4 (Finals).`;
    }
  }

  if (matches.length === 0) {
    listEl.innerHTML = '<p style="color: var(--text-muted);">Aktuell sind keine Spielpaarungen aktiv.</p>';
    return;
  }

  matches.sort((a, b) => (a.is_completed === b.is_completed) ? 0 : a.is_completed ? 1 : -1);

  let html = '';
  matches.forEach(m => {
    const p1Name = m.p1 ? m.p1.name : 'Spieler 1';
    const p2Name = m.p2 ? m.p2.name : 'Spieler 2';
    const isBestOf3 = ['zwischenrunde', 'finale', 'platz_3'].includes(m.phase);
    
    let phaseTitle = m.phase.toUpperCase();
    if (m.phase === 'gruppe_a') phaseTitle = '🔵 GRUPPE A';
    if (m.phase === 'gruppe_b') phaseTitle = '🟡 GRUPPE B';
    if (m.phase === 'zwischenrunde') phaseTitle = 'ZWISCHENRUNDE (BEST OF 3)';
    if (m.phase === 'finale') phaseTitle = '🏆 FINALE (BEST OF 3)';
    if (m.phase === 'platz_3') phaseTitle = '🥉 SPIEL UM PLATZ 3';

    const isBoard2 = (m.board === 'Board 2');
    const boardNum = isBoard2 ? '2' : '1';
    const boardClass = isBoard2 ? 'board-2' : 'board-1';

    if (m.is_completed) {
      const winnerName = m.winner_id === m.player1_id ? p1Name : p2Name;
      const scoreDetail = isBestOf3 ? `Legs: ${m.p1_legs || 0} : ${m.p2_legs || 0}` : `Restpunkte: ${m.p1_rest_points || 0} : ${m.p2_rest_points || 0}`;

      html += `
        <div class="match-card completed">
          <div class="board-badge-container">
            <img src="Dart_board.png" class="real-dartboard-img" alt="Dartboard">
            <div class="board-number-overlay ${boardClass}">${boardNum}</div>
          </div>

          <div class="match-content">
            <div class="match-header-info">
              <span>${phaseTitle} — Runde ${m.round_number || 1}</span>
              <button onclick="reopenMatch('${m.id}')" style="width: auto; padding: 0.2rem 0.6rem; font-size: 0.8rem; background: #3d372e; color: #fff;" title="Ergebnis korrigieren">
                ✏️ Bearbeiten
              </button>
            </div>

            <div class="vs-grid">
              <div class="player-title">${p1Name}</div>
              <div class="vs-divider">VS</div>
              <div class="player-title">${p2Name}</div>
            </div>

            <div style="font-size: 0.9rem; color: var(--accent); margin-top: 0.4rem; text-align: center; background: var(--card); padding: 0.4rem; border-radius: 6px; border: 1px solid var(--border);">
              🏆 Sieger: <strong>${winnerName}</strong> (${scoreDetail})
            </div>
          </div>
        </div>`;
    } else {
      if (isBestOf3) {
        // BEST-OF-3 EINGABE-LAYOUT (Leg 1, Leg 2, Leg 3)
        html += `
          <div class="match-card">
            <div class="board-badge-container">
              <img src="Dart_board.png" class="real-dartboard-img" alt="Dartboard">
              <div class="board-number-overlay ${boardClass}">${boardNum}</div>
            </div>

            <div class="match-content">
              <div class="match-header-info">
                <span>${phaseTitle}</span>
              </div>

              <div class="vs-grid">
                <div class="player-title">${p1Name}</div>
                <div class="vs-divider">VS</div>
                <div class="player-title">${p2Name}</div>
              </div>

              <!-- LEG 1 -->
              <div style="font-size: 0.8rem; color: var(--accent); margin-top: 0.4rem; font-weight: bold;">Leg 1:</div>
              <div class="match-inputs-grid">
                <input type="number" id="bo3_l1_p1_${m.id}" placeholder="Rest ${p1Name}" min="0" oninput="checkBo3Status('${m.id}')" style="text-align: center;">
                <input type="number" id="bo3_l1_p2_${m.id}" placeholder="Rest ${p2Name}" min="0" oninput="checkBo3Status('${m.id}')" style="text-align: center;">
              </div>

              <!-- LEG 2 -->
              <div style="font-size: 0.8rem; color: var(--accent); margin-top: 0.4rem; font-weight: bold;">Leg 2:</div>
              <div class="match-inputs-grid">
                <input type="number" id="bo3_l2_p1_${m.id}" placeholder="Rest ${p1Name}" min="0" oninput="checkBo3Status('${m.id}')" style="text-align: center;">
                <input type="number" id="bo3_l2_p2_${m.id}" placeholder="Rest ${p2Name}" min="0" oninput="checkBo3Status('${m.id}')" style="text-align: center;">
              </div>

              <!-- LEG 3 (Optional) -->
              <div id="bo3_l3_wrapper_${m.id}">
                <div style="font-size: 0.8rem; color: var(--accent); margin-top: 0.4rem; font-weight: bold;">Leg 3 (Entscheidungs-Leg):</div>
                <div class="match-inputs-grid">
                  <input type="number" id="bo3_l3_p1_${m.id}" placeholder="Rest ${p1Name}" min="0" style="text-align: center;">
                  <input type="number" id="bo3_l3_p2_${m.id}" placeholder="Rest ${p2Name}" min="0" style="text-align: center;">
                </div>
              </div>

              <button onclick="submitBo3Result('${m.id}', '${m.player1_id}', '${m.player2_id}')" style="margin-top: 0.8rem;">
                Best-of-3 Ergebnis Speichern
              </button>
            </div>
          </div>`;
      } else {
        // STANDARD 1-LEG EINGABE (Vorrunde & Gruppenphase)
        html += `
          <div class="match-card">
            <div class="board-badge-container">
              <img src="Dart_board.png" class="real-dartboard-img" alt="Dartboard">
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
    }
  });

  listEl.innerHTML = html;
}

// Prüft live, ob Leg 3 bei 2:0 nicht mehr benötigt wird
function checkBo3Status(matchId) {
  const l1p1 = parseInt(document.getElementById(`bo3_l1_p1_${matchId}`)?.value, 10);
  const l1p2 = parseInt(document.getElementById(`bo3_l1_p2_${matchId}`)?.value, 10);
  const l2p1 = parseInt(document.getElementById(`bo3_l2_p1_${matchId}`)?.value, 10);
  const l2p2 = parseInt(document.getElementById(`bo3_l2_p2_${matchId}`)?.value, 10);

  const l3Wrapper = document.getElementById(`bo3_l3_wrapper_${matchId}`);
  if (!l3Wrapper) return;

  let p1Legs = 0;
  let p2Legs = 0;

  if (l1p1 === 0) p1Legs++; else if (l1p2 === 0) p2Legs++;
  if (l2p1 === 0) p1Legs++; else if (l2p2 === 0) p2Legs++;

  if (p1Legs === 2 || p2Legs === 2) {
    l3Wrapper.style.opacity = '0.3';
    l3Wrapper.style.pointerEvents = 'none';
  } else {
    l3Wrapper.style.opacity = '1';
    l3Wrapper.style.pointerEvents = 'auto';
  }
}

// Speichert ein Best-of-3 Ergebnis
async function submitBo3Result(matchId, p1Id, p2Id) {
  const l1p1 = parseInt(document.getElementById(`bo3_l1_p1_${matchId}`)?.value, 10);
  const l1p2 = parseInt(document.getElementById(`bo3_l1_p2_${matchId}`)?.value, 10);
  const l2p1 = parseInt(document.getElementById(`bo3_l2_p1_${matchId}`)?.value, 10);
  const l2p2 = parseInt(document.getElementById(`bo3_l2_p2_${matchId}`)?.value, 10);
  const l3p1 = parseInt(document.getElementById(`bo3_l3_p1_${matchId}`)?.value, 10);
  const l3p2 = parseInt(document.getElementById(`bo3_l3_p2_${matchId}`)?.value, 10);

  let p1Legs = 0;
  let p2Legs = 0;

  if (l1p1 === 0) p1Legs++; else if (l1p2 === 0) p2Legs++;
  if (l2p1 === 0) p1Legs++; else if (l2p2 === 0) p2Legs++;

  if (p1Legs === 1 && p2Legs === 1) {
    if (l3p1 === 0) p1Legs++; else if (l3p2 === 0) p2Legs++;
  }

  if (p1Legs < 2 && p2Legs < 2) {
    alert('Bitte trage die Ergebnisse so ein, dass ein Spieler 2 Legs gewinnt!');
    return;
  }

  const winnerId = p1Legs === 2 ? p1Id : p2Id;

  const { error } = await supabaseClient.from('matches').update({
    winner_id: winnerId,
    p1_legs: p1Legs,
    p2_legs: p2Legs,
    is_completed: true
  }).eq('id', matchId);

  if (error) {
    alert('Fehler beim Speichern: ' + error.message);
  } else {
    loadRanking();
    loadMatches();
  }
}

// 10. Ergebnis 1-Leg eintragen
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

// 11. Match zur Korrektur freischalten
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
