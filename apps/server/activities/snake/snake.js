// Multiplayer Snake. The host (whoever started the activity) runs the rules and sends the state to everyone each step;
// the others send only the direction they want to turn.
import { connect } from './orvo-activity.js';
import { COLS, ROWS, createGame, decodeCell, encode, removePlayer, steer, step } from './sim.js';

const TICK_MS = 110;
const COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171'];
const KEYS = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};

const orvo = await connect();

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const scoreboard = document.getElementById('scores');
const status = document.getElementById('status');
const action = document.getElementById('action');
const hint = document.getElementById('hint');

/** What is on screen: the lobby, or the latest state from the host. */
let view = { phase: 'lobby' };
let game = null;
let timer = null;

const nameOf = (id) => orvo.participants.find((p) => p.id === id)?.name ?? 'Player';
const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function broadcast() {
  orvo.send({ t: 'state', s: view });
}

function startRound() {
  if (!orvo.isHost) return;
  clearInterval(timer);
  game = createGame(orvo.participants.map((p) => p.id));
  view = encode(game);
  broadcast();
  draw();
  timer = setInterval(() => {
    step(game);
    view = encode(game);
    if (game.phase !== 'playing') clearInterval(timer);
    broadcast();
    draw();
  }, TICK_MS);
}

if (orvo.isHost) {
  orvo.onMessage(({ from, data }) => {
    if (data?.t === 'dir' && game) steer(game, from, data.d);
  });
  orvo.onParticipants((_all, change) => {
    if (change.left && game?.phase === 'playing') {
      removePlayer(game, change.left);
      view = encode(game);
    }
    // Someone new needs the current picture, and the lobby text needs the new count.
    broadcast();
    draw();
  });
  action.addEventListener('click', startRound);
} else {
  orvo.onMessage(({ from, data }) => {
    if (from !== orvo.host || data?.t !== 'state') return;
    view = data.s;
    draw();
  });
}

orvo.onParticipants(() => draw());

function turn(dir) {
  if (orvo.isHost) {
    if (game) steer(game, orvo.self.id, dir);
  } else {
    orvo.send({ t: 'dir', d: dir }, orvo.host);
  }
}

window.addEventListener('keydown', (event) => {
  const dir = KEYS[event.key];
  if (!dir) return;
  event.preventDefault();
  turn(dir);
});

// Keys only reach the activity once its frame has focus.
const showHint = () => hint.classList.toggle('visible', !document.hasFocus());
window.addEventListener('focus', showHint);
window.addEventListener('blur', showHint);
document.addEventListener('pointerdown', () => window.focus());
showHint();

const colorOf = (id) => {
  const index = (view.snakes ?? []).findIndex((s) => s.id === id);
  return COLORS[(index < 0 ? 0 : index) % COLORS.length];
};

function draw() {
  const stage = canvas.parentElement;
  const ratio = window.devicePixelRatio || 1;
  const cellPx = Math.max(1, Math.floor(Math.min(stage.clientWidth / COLS, stage.clientHeight / ROWS)));
  const width = cellPx * COLS;
  const height = cellPx * ROWS;
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = css('--surface', '#241f1b');
  ctx.fillRect(0, 0, width, height);

  const snakes = view.snakes ?? [];
  if (view.food != null) {
    const food = decodeCell(view.food);
    ctx.fillStyle = css('--live', '#f5f5f5');
    ctx.beginPath();
    ctx.arc(food.x * cellPx + cellPx / 2, food.y * cellPx + cellPx / 2, cellPx * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const snake of snakes) {
    ctx.fillStyle = colorOf(snake.id);
    snake.body.forEach((n, i) => {
      const c = decodeCell(n);
      ctx.globalAlpha = i === 0 ? 1 : 0.8;
      ctx.fillRect(c.x * cellPx + 1, c.y * cellPx + 1, cellPx - 2, cellPx - 2);
    });
    ctx.globalAlpha = 1;
  }

  scoreboard.replaceChildren(
    ...(snakes.length ? snakes : orvo.participants.map((p) => ({ id: p.id, score: 0, alive: true }))).map((s) => {
      const chip = document.createElement('span');
      chip.className = s.alive ? 'chip' : 'chip out';
      const dot = document.createElement('i');
      dot.style.background = snakes.length ? colorOf(s.id) : COLORS[orvo.participants.findIndex((p) => p.id === s.id) % COLORS.length];
      chip.append(dot, `${nameOf(s.id)}${s.id === orvo.self.id ? ' (you)' : ''}: ${s.score}`);
      return chip;
    }),
  );

  const playing = view.phase === 'playing';
  const mine = snakes.some((s) => s.id === orvo.self.id);
  if (view.phase === 'lobby') {
    status.textContent = orvo.isHost
      ? `${orvo.participants.length} player${orvo.participants.length === 1 ? '' : 's'} here. Start when everyone is ready.`
      : `Waiting for ${nameOf(orvo.host)} to start.`;
  } else if (playing) {
    status.textContent = mine ? 'Steer with the arrow keys or WASD.' : 'A round is running. You will join the next one.';
  } else {
    status.textContent = view.winner
      ? `${nameOf(view.winner)} wins.`
      : view.solo
        ? `Game over. You scored ${snakes[0]?.score ?? 0}.`
        : 'Nobody wins that one.';
  }
  action.hidden = !orvo.isHost || playing;
  action.textContent = view.phase === 'lobby' ? 'Start' : 'Play again';
}

window.addEventListener('resize', draw);
orvo.onClose(() => clearInterval(timer));
draw();
