// Supabase Konfiguration
const SUPABASE_URL = 'https://kivrithhtptvjjotkgzr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpdnJpdGhodHB0dmpqb3RrZ3pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNjgxMjIsImV4cCI6MjEwNjg0NDEyMn0.N86vpqON6XIEYAZjHr7AEd4vJ9DhfG_oDrWRqH8kJdM';

// Supabase Client initialisieren
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentPlayer = localStorage.getItem('dart_player_name') || null;

// Realtime Subscriber einrichten für automatische Updates bei allen Teilnehmern
supabaseClient
  .channel('turnier_updates')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
    loadRanking();
    loadMatches();
  })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
    loadRanking();
    loadMatches();
  })
  .subscribe();

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
    // Versuch, den Spieler in Supabase anzulegen
    const { data, error } = await supabaseClient
      .from('players')
      .insert([{ name: nameInput }])
      .select();

    if (error && !error.message.includes('duplicate')) {
      console.warn('Hinweis beim Anlegen:', error.message);
    }

    // Name lokal im Browser speichern
    localStorage.setItem('dart_player_name', nameInput);
    currentPlayer = nameInput;

    const authSec = document.getElementById('auth-section');
    if (authSec) authSec.style.display = 'none';

    alert(`Willkommen beim Turnier, ${nameInput}!`);

    loadRanking();
    loadMatches();

  } catch (err) {
    console.error('Fehler bei der Anmeldung:', err);
    alert('Verbindungsfehler: ' + err.message);
  }
}

// 2. Live-Rangliste laden & Tiebreaker berechnen
// Regel: 1. Siege/Punkte (höher besser), 2. Restpunkte (niedriger besser)
async function loadRanking() {
  const rankingEl = document.getElementById('ranking-table');
  if (!rankingEl) return;

  const { data: players, error: pErr } = await supabaseClient.from('players').select('*');
  const { data: matches, error: mErr } = await supabaseClient.from('matches').select('*').eq('is_completed', true);

  if (pErr || !players) {
    rankingEl.innerHTML = '<p style="color: var(--text-muted);">Noch keine Spieler angemeldet.</p>';
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

  // Sortierung nach Turnierregeln:
  // 1. Meiste Siege (Punkte)
  // 2. WENIGER Restpunkte
  stats.sort((a, b) => b.points - a.points || a.restPoints - b.restPoints);

  if (stats.length === 0) {
    rankingEl.innerHTML = '<p style="color: var(--text-muted);">Noch keine Daten vorhanden.</p>';
    return;
  }

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
    const isMe = s.name === currentPlayer ? ' (Du)' : '';
    html += `<tr>
      <td><strong>${i + 1}</strong></td>
      <td>${s.name}${isMe}</td>
      <td>${s.played}</td>
      <td><strong style="color: var(--accent);">${s.points}</strong></td>
      <td>${s.restPoints}</td>
    </tr>`;
  });

  html += `</tbody></table>`;
  rankingEl.innerHTML = html;
}

// 3. Vorrunde generieren (Jeder gegen Jeden - 301 Single Out)
async function generateVorrunde() {
  const { data: players } = await supabaseClient.from('players').select('*');
  if (!players || players.length < 2) {
    alert('Es müssen mindestens 2 Spieler angemeldet sein!');
    return;
  }

  if (!confirm('Möchtest du die Vorrunde jetzt starten? Es werden alle Duelle generiert.')) {
    return;
  }

  // Bestehende Matches zurücksetzen
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
    alert('Fehler beim Erstellen der Vorrunde: ' + error
