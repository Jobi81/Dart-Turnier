// Supabase Initalisierung (Eigene Anmeldedaten einsetzen)
const SUPABASE_URL = 'https://kivrithhtptvjjotkgzr.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpdnJpdGhodHB0dmpqb3RrZ3pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNjgxMjIsImV4cCI6MjEwNjg0NDEyMn0.N86vpqON6XIEYAZjHr7AEd4vJ9DhfG_oDrWRqH8kJdM';
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentPlayer = localStorage.getItem('dart_player_name') || null;

// Realtime Subscriber einrichten
supabase
  .channel('turnier_updates')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
    loadRanking();
    loadMatches();
  })
  .subscribe();

// 1. Spieler Registrierung
async function registerPlayer() {
  const nameInput = document.getElementById('player-name-input').value.trim();
  if (!nameInput) return alert('Bitte Namen eingeben!');

  const { data, error } = await supabase.from('players').insert([{ name: nameInput }]).select();
  if (error) {
    alert('Fehler oder Name vergeben: ' + error.message);
  } else {
    localStorage.setItem('dart_player_name', nameInput);
    currentPlayer = nameInput;
    document.getElementById('auth-section').style.display = 'none';
    loadRanking();
    loadMatches();
  }
}

// 2. Tiebreaker & Live-Tabelle berechnen
// Regel: 1. Siege/Punkte (höher besser), 2. Restpunkte (niedriger besser)
async function loadRanking() {
  const { data: players } = await supabase.from('players').select('*');
  const { data: matches } = await supabase.from('matches').select('*').eq('is_completed', true);

  if (!players) return;

  const stats = players.map(p => {
    let points = 0;
    let restPoints = 0;

    matches?.forEach(m => {
      if (m.player1_id === p.id) {
        if (m.winner_id === p.id) points += 1;
        else restPoints += m.p1_rest_points;
      }
      if (m.player2_id === p.id) {
        if (m.winner_id === p.id) points += 1;
        else restPoints += m.p2_rest_points;
      }
    });

    return { name: p.name, points, restPoints };
  });

  // Sortierung nach Turnierregeln
  stats.sort((a, b) => b.points - a.points || a.restPoints - b.restPoints);

  let html = `<table class="table">
    <tr><th>Platz</th><th>Spieler</th><th>Siege</th><th>Rest-Pkt</th></tr>`;
  stats.forEach((s, i) => {
    html += `<tr>
      <td>#${i + 1}</td>
      <td><strong>${s.name}</strong></td>
      <td>${s.points}</td>
      <td>${s.restPoints}</td>
    </tr>`;
  });
  html += `</table>`;
  document.getElementById('ranking-table').innerHTML = html;
}

// 3. Ergebnis eintragen
async function submitMatchResult(matchId, winnerId, p1Rest, p2Rest) {
  await supabase.from('matches').update({
    winner_id: winnerId,
    p1_rest_points: p1Rest,
    p2_rest_points: p2Rest,
    is_completed: true,
    updated_at: new Date()
  }).eq('id', matchId);

  loadRanking();
  loadMatches();
}
