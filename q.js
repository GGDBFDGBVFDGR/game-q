let QUESTIONS = ROOMS;
let GAME = "";
let LINK = (new URLSearchParams(location.search).get("room") || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
const ROOM = 108;
const GAP = 40;
const HALL = 56;
const PAD = 18;
const PITCH = ROOM + GAP;
const COLS = 5;
const HIT = 12;
const SPEED = 170;
const PENALTY = 3;
const CUT_COST = 2;
const REVEAL_COST = 5;

const maze = document.getElementById("maze");
const mazeWrap = document.getElementById("maze-wrap");
const robot = document.getElementById("robot");
const sprite = document.getElementById("sprite");
const robotB = robot.cloneNode(true);
robotB.id = "robot-b";
robotB.classList.add("robot-b");
robotB.setAttribute("aria-label", "Робот команды 2");
const spriteB = robotB.querySelector(".sprite");
spriteB.id = "sprite-b";
robotB.querySelector("svg").innerHTML = robotB.querySelector("svg").innerHTML
  .replaceAll("id=\"metal\"", "id=\"metal-b\"")
  .replaceAll("id=\"screen\"", "id=\"screen-b\"")
  .replaceAll("id=\"glow\"", "id=\"glow-b\"")
  .replaceAll("url(#metal)", "url(#metal-b)")
  .replaceAll("url(#screen)", "url(#screen-b)")
  .replaceAll("url(#glow)", "url(#glow-b)");
maze.appendChild(robotB);
function blankLog() {
  return {
    picks: new Map(),
    results: new Map(),
    passed: new Set(),
    removed: new Map(),
    revealed: new Set(),
    correctCount: 0,
    cheering: false,
    done: false,
  };
}

const pilots = [
  { id: "1", el: robot, sprite, x: 0, y: 0, facing: 1, moving: false, roomId: 0, ...blankLog() },
  { id: "2", el: robotB, sprite: spriteB, x: 0, y: 0, facing: 1, moving: false, roomId: 0, ...blankLog() },
];
let focusTeam = "1";

function focusPilot() {
  return pilots.find((pilot) => pilot.id === focusTeam) || pilots[0];
}

function pilotById(id) {
  return pilots.find((pilot) => pilot.id === String(id));
}
const pads = {
  1: { up: false, down: false, left: false, right: false, connected: false },
  2: { up: false, down: false, left: false, right: false, connected: false },
};
const localPad = {
  1: { up: false, down: false, left: false, right: false },
  2: { up: false, down: false, left: false, right: false },
};
const teamWhere = document.getElementById("team-where");
let hostOrigin = "";
let qrReady = false;
let seenAnswer = 0;
let seenShop = 0;
const bubble = document.getElementById("bubble");
const status = document.getElementById("status");
const progress = document.getElementById("progress");
const purseLabel = document.getElementById("purse");
const keyLabel = document.getElementById("key-label");
const spendCut = document.getElementById("spend-cut");
const spendReveal = document.getElementById("spend-reveal");
const roomKicker = document.getElementById("room-kicker");
const roomTitle = document.getElementById("room-title");
const question = document.getElementById("question");
const answers = document.getElementById("answers");
const feedback = document.getElementById("feedback");
const crash = document.getElementById("crash");
const dance = document.getElementById("dance");
const fx = document.getElementById("fx");
const restart = document.getElementById("restart");

let CELLS = [];
let PATH = [];
let MAZE_W = 0;
let MAZE_H = 0;
let byId = new Map();

function neighborSpot(cell, occupied) {
  const options = [
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 },
  ];
  return options.find((spot) => spot.x >= 0 && spot.y >= 0 && !occupied.has(`${spot.x},${spot.y}`)) || null;
}

function prepareLayout() {
  const count = QUESTIONS.length;
  const snake = [];
  let left = count;
  for (let row = 0; left > 0; row += 1) {
    const width = Math.min(COLS, left);
    const xs = row % 2 === 0
      ? Array.from({ length: width }, (_, index) => index)
      : Array.from({ length: width }, (_, index) => COLS - 1 - index);
    xs.forEach((x) => snake.push({ x, y: row }));
    left -= width;
  }
  CELLS = snake.map((spot, index) => ({
    id: index + 1,
    x: spot.x,
    y: spot.y,
    kind: "quiz",
    quiz: index,
  }));
  const occupied = new Set(CELLS.map((cell) => `${cell.x},${cell.y}`));
  PATH = CELLS.slice(0, -1).map((cell) => [cell.id, cell.id + 1]);
  const openHost = CELLS[4];
  const openSpot = openHost ? neighborSpot(openHost, occupied) : null;
  if (openSpot) {
    const secret = { id: CELLS.length + 1, x: openSpot.x, y: openSpot.y, kind: "secret", quiz: null, chest: "open", reward: 8 };
    CELLS.push(secret);
    occupied.add(`${openSpot.x},${openSpot.y}`);
    PATH.push([openHost.id, secret.id]);
  }
  if (count >= 10) {
    const host = CELLS[Math.min(12, count - 1)];
    const spot = neighborSpot(host, occupied);
    if (spot) {
      const secret = { id: CELLS.length + 1, x: spot.x, y: spot.y, kind: "secret", quiz: null, chest: "locked", reward: 12 };
      CELLS.push(secret);
      PATH.push([host.id, secret.id]);
    }
  }
  MAZE_W = PAD * 2 + Math.max(...CELLS.map((cell) => cell.x)) * PITCH + ROOM;
  MAZE_H = PAD * 2 + Math.max(...CELLS.map((cell) => cell.y)) * PITCH + ROOM;
  byId = new Map(CELLS.map((cell) => [cell.id, cell]));
}

function roomHasKey(cell) {
  return QUESTIONS.length >= 10 && (cell.id === 4 || cell.id === 10);
}
const passed = new Set();
const seen = new Set();
const results = new Map();
const picks = new Map();
const halls = [];
const coins = [];
const keyPickups = [];
const chests = [];
const removed = new Map();
const revealed = new Set();
const keys = new Set();

let purse = 0;
let keyCount = 0;
let correctCount = 0;
let activeId = 0;
let facing = 1;
let roomSpeech = "";
let cheering = false;
let last = performance.now();
let x = 0;
let y = 0;
let route = [];
let ended = false;

function roomRect(cell) {
  return {
    x: PAD + cell.x * PITCH,
    y: PAD + cell.y * PITCH,
    w: ROOM,
    h: ROOM,
  };
}

function centerOf(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function corridorRect(a, b) {
  const ra = roomRect(a);
  const rb = roomRect(b);
  if (a.y === b.y) {
    const left = ra.x < rb.x ? ra : rb;
    const right = ra.x < rb.x ? rb : ra;
    return {
      x: left.x + ROOM,
      y: left.y + (ROOM - HALL) / 2,
      w: right.x - (left.x + ROOM),
      h: HALL,
    };
  }
  const top = ra.y < rb.y ? ra : rb;
  const bottom = ra.y < rb.y ? rb : ra;
  return {
    x: top.x + (ROOM - HALL) / 2,
    y: top.y + ROOM,
    w: HALL,
    h: bottom.y - (top.y + ROOM),
  };
}

function contains(rect, px, py) {
  return px >= rect.x && py >= rect.y && px <= rect.x + rect.w && py <= rect.y + rect.h;
}

function doorOpen(hall, pilot) {
  if (pilot) return pilot.passed.has(hall.a) || pilot.passed.has(hall.b);
  return pilots.some((item) => item.passed.has(hall.a) || item.passed.has(hall.b));
}

function pointOpen(px, py, pilot) {
  if (CELLS.some((cell) => contains(roomRect(cell), px, py))) return true;
  return halls.some((hall) => doorOpen(hall, pilot) && contains(hall.rect, px, py));
}

function walkable(px, py, pilot) {
  return [
    [px, py],
    [px - HIT, py],
    [px + HIT, py],
    [px, py - HIT],
    [px, py + HIT],
  ].every(([sx, sy]) => pointOpen(sx, sy, pilot));
}

function touchesLocked(px, py, pilot) {
  return [
    [px, py],
    [px - HIT, py],
    [px + HIT, py],
    [px, py - HIT],
    [px, py + HIT],
  ].some(([sx, sy]) => halls.some((hall) => !doorOpen(hall, pilot) && contains(hall.rect, sx, sy)));
}

function roomAt(px, py) {
  return CELLS.find((cell) => contains(roomRect(cell), px, py)) || null;
}

function neighbors(cell) {
  return PATH.filter((link) => link[0] === cell.id || link[1] === cell.id).map((link) =>
    byId.get(link[0] === cell.id ? link[1] : link[0])
  );
}

function coinsLeft(cell) {
  return coins.filter((coin) => coin.roomId === cell.id && !coin.taken).length;
}

function buildMaze() {
  maze.style.width = `${MAZE_W}px`;
  maze.style.height = `${MAZE_H}px`;

  PATH.forEach(([fromId, toId]) => {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    const rect = corridorRect(from, to);
    const el = document.createElement("div");
    el.className = `corridor ${from.y === to.y ? "is-horizontal" : "is-vertical"}`;
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    maze.insertBefore(el, robot);
    halls.push({ a: fromId, b: toId, rect, el });
  });

  CELLS.forEach((cell) => {
    const rect = roomRect(cell);
    const el = document.createElement("div");
    const quiz = cell.kind === "quiz" ? QUESTIONS[cell.quiz] : null;
    el.className = `room${cell.kind === "secret" ? " is-secret" : ""}`;
    el.dataset.id = String(cell.id);
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    el.innerHTML = `<span class="room-index">${String(cell.id).padStart(2, "0")}</span><span class="room-code">${quiz ? quiz.code : t("chestTag")}</span>`;
    maze.insertBefore(el, robot);
    if (cell.kind === "quiz") {
      const count = 1 + Math.floor(Math.random() * 2);
      const spots = [];
      const centerX = rect.x + rect.w / 2;
      const centerY = rect.y + rect.h / 2;
      let guard = 0;
      while (spots.length < count && guard < 40) {
        guard += 1;
        const nutX = rect.x + 18 + Math.random() * (rect.w - 36);
        const nutY = rect.y + 18 + Math.random() * (rect.h - 36);
        const onRobot = Math.hypot(nutX - centerX, nutY - centerY) < 28;
        const onKey = roomHasKey(cell) && Math.hypot(nutX - centerX, nutY - (rect.y + 28)) < 22;
        const crowded = spots.some((spot) => Math.hypot(spot.x - nutX, spot.y - nutY) < 30);
        if (onRobot || onKey || crowded) continue;
        spots.push({ x: nutX, y: nutY });
      }
      spots.forEach((spot) => addCoin(cell.id, spot.x, spot.y));
      if (roomHasKey(cell)) addKey(cell.id, rect.x + rect.w / 2, rect.y + 28);
    }
    if (cell.kind === "secret") addChest(cell, rect);
  });
}

function addKey(roomId, keyX, keyY) {
  const el = document.createElement("div");
  el.className = "key";
  el.style.left = `${keyX}px`;
  el.style.top = `${keyY}px`;
  maze.insertBefore(el, robot);
  keyPickups.push({ roomId, x: keyX, y: keyY, el, taken: false });
}

function addChest(cell, rect) {
  const spot = centerOf(rect);
  const el = document.createElement("div");
  el.className = `chest${cell.chest === "locked" ? " is-locked" : ""}`;
  el.style.left = `${spot.x}px`;
  el.style.top = `${spot.y}px`;
  maze.insertBefore(el, robot);
  chests.push({
    roomId: cell.id,
    x: spot.x,
    y: spot.y,
    locked: cell.chest === "locked",
    reward: cell.reward,
    opened: false,
    originalLocked: cell.chest === "locked",
    el,
  });
}

function addCoin(roomId, coinX, coinY) {
  const el = document.createElement("div");
  el.className = "coin";
  el.style.left = `${coinX}px`;
  el.style.top = `${coinY}px`;
  maze.insertBefore(el, robot);
  coins.push({ roomId, x: coinX, y: coinY, el, taken: false });
}

function paintRooms() {
  document.querySelectorAll(".room").forEach((el) => {
    const id = Number(el.dataset.id);
    el.classList.toggle("is-current", id === activeId);
    el.classList.toggle("is-clear", pilots.some((pilot) => pilot.passed.has(id)));
    el.classList.toggle("is-seen", seen.has(id));
  });
}

function paintDoors() {
  halls.forEach((hall) => {
    const openCount = pilots.filter((pilot) => doorOpen(hall, pilot)).length;
    hall.el.classList.toggle("is-open", openCount > 0);
    hall.el.classList.toggle("is-half", openCount === 1);
  });
}

function nutsWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return t("nut1");
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t("nut2");
  return t("nut5");
}

function setProgress() {
  purseLabel.textContent = t("nuts", { n: purse });
  keyLabel.textContent = t("keys", { n: keyCount });
  progress.textContent = `1 ${pilots[0].correctCount}/${QUESTIONS.length} · 2 ${pilots[1].correctCount}/${QUESTIONS.length}`;
  paintShop();
  publishQuestions();
}

function wrongLeft(cell, pilot) {
  const gone = pilot.removed.get(cell.quiz) || new Set();
  return QUESTIONS[cell.quiz].choices.filter((_, index) => index !== QUESTIONS[cell.quiz].answer && !gone.has(index)).length;
}

function paintShop() {
  const pilot = focusPilot();
  const cell = roomAt(pilot.x, pilot.y);
  const ready = cell && cell.kind === "quiz" && !pilot.picks.has(cell.quiz) && !pilot.done && !pilot.cheering;
  spendCut.disabled = !ready || purse < CUT_COST || wrongLeft(cell, pilot) === 0 || pilot.revealed.has(cell.quiz);
  spendReveal.disabled = !ready || purse < REVEAL_COST || pilot.revealed.has(cell.quiz);
}

function renderPanel(cell, pilot = focusPilot()) {
  if (cell.kind === "secret") {
    const chest = chests.find((item) => item.roomId === cell.id);
    roomKicker.textContent = t("teamSecret", { id: pilot.id });
    roomTitle.textContent = cell.chest === "locked" ? t("chestLocked") : t("chest");
    question.textContent = chest && chest.opened
      ? t("chestOpened")
      : cell.chest === "locked"
        ? t("chestNeedKey")
        : t("chestWalk");
    answers.replaceChildren();
    feedback.textContent = "";
    paintShop();
    publishQuestions();
    return;
  }

  const quiz = QUESTIONS[cell.quiz];
  const picked = pilot.picks.get(cell.quiz);
  const other = pilots.find((item) => item.id !== pilot.id);
  roomKicker.textContent = t("teamQuestion", { id: pilot.id, n: String(cell.quiz + 1).padStart(2, "0") });
  roomTitle.textContent = quiz.title;
  question.textContent = quiz.prompt;
  if (picked === undefined) {
    feedback.textContent = other && other.picks.has(cell.quiz)
      ? t("otherStill", { other: other.id, id: pilot.id })
      : "";
  } else {
    feedback.textContent = pilot.results.get(cell.quiz) ? t("teamCorrect", { id: pilot.id }) : t("teamWrongNow", { id: pilot.id, n: purse });
  }
  answers.replaceChildren();
  quiz.choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${index + 1}. ${choice}`;
    const answered = picked !== undefined;
    button.disabled = answered || pilot.done || pilot.cheering;
    button.addEventListener("click", () => choose(cell, index, button, pilot.id));
    answers.appendChild(button);
  });
  paintShop();
  publishQuestions();
}

function enter(cell, pilot = focusPilot()) {
  focusTeam = pilot.id;
  activeId = cell.id;
  seen.add(cell.id);
  const other = pilots.find((item) => item.id !== pilot.id);
  if (cell.kind === "secret") {
    roomSpeech = cell.chest === "locked" ? t("secretLocked") : t("secretOpen");
  } else if (pilot.picks.has(cell.quiz)) {
    roomSpeech = pilot.results.get(cell.quiz)
      ? t("alreadyRight", { id: pilot.id })
      : t("alreadyPassed", { id: pilot.id });
  } else {
    const keyHere = keyPickups.some((item) => item.roomId === cell.id && !item.taken);
    roomSpeech = t("enterQuiz", { title: QUESTIONS[cell.quiz].title, id: pilot.id });
    if (other && other.picks.has(cell.quiz)) roomSpeech += t("otherPassed", { id: other.id });
    if (keyHere) roomSpeech += t("keyFloor");
  }
  bubble.textContent = roomSpeech;
  status.textContent = cell.kind === "secret" ? t("secretStatus") : t("teamStatus", { id: pilot.id, n: String(cell.quiz + 1).padStart(2, "0") });
  renderPanel(cell, pilot);
  paintRooms();
}

function placeAtStart() {
  const start = centerOf(roomRect(CELLS[0]));
  pilots[0].x = start.x + 18;
  pilots[0].y = start.y;
  pilots[0].facing = 1;
  pilots[0].roomId = 0;
  pilots[1].x = start.x - 18;
  pilots[1].y = start.y;
  pilots[1].facing = -1;
  pilots[1].roomId = 0;
  route = [];
}

function pilotNear(px, py, radius) {
  return pilots.some((pilot) => !pilot.cheering && !pilot.done && Math.hypot(pilot.x - px, pilot.y - py) <= radius);
}

function focusQuestion(cell, pilot) {
  if (cell.kind === "quiz" && !pilot.picks.has(cell.quiz)) {
    enter(cell, pilot);
    return;
  }
  const current = byId.get(activeId);
  const currentOpen = current && current.kind === "quiz" && !focusPilot().picks.has(current.quiz);
  if (currentOpen) {
    publishQuestions();
    return;
  }
  enter(cell, pilot);
}

function hallBetween(a, b) {
  return halls.find((hall) => (hall.a === a.id && hall.b === b.id) || (hall.a === b.id && hall.b === a.id));
}

function openForward(pilot, cell) {
  paintDoors();
  paintRooms();
  setProgress();
  const quizOk = cell.kind === "quiz" ? pilot.results.get(cell.quiz) : true;
  const other = pilots.find((item) => item.id !== pilot.id);
  const waiting = other && cell.kind === "quiz" && !other.picks.has(cell.quiz);
  const tail = waiting ? t("mustAnswer", { id: other.id }) : "";
  roomSpeech = quizOk
    ? `${t("goOn", { id: pilot.id })}${tail}`
    : `${t("wrongDoor", { id: pilot.id })}${tail}`;
  bubble.textContent = roomSpeech;
  if (focusTeam === pilot.id) renderPanel(cell, pilot);
}

function collectCoins() {
  if (ended) return;
  let picked = 0;
  coins.forEach((coin) => {
    if (coin.taken || !pilotNear(coin.x, coin.y, 22)) return;
    coin.taken = true;
    coin.el.classList.add("is-taken");
    picked += 1;
  });
  if (picked) {
    purse += picked;
    roomSpeech = t("nutPocket", { n: purse });
    bubble.textContent = roomSpeech;
    setProgress();
  }
  keyPickups.forEach((item) => {
    if (item.taken || !pilotNear(item.x, item.y, 22)) return;
    item.taken = true;
    item.el.classList.add("is-taken");
    keyCount += 1;
    roomSpeech = t("keyFound", { n: keyCount });
    bubble.textContent = roomSpeech;
    setProgress();
  });

  chests.forEach((chest) => {
    if (chest.opened || !pilotNear(chest.x, chest.y, 28)) return;
    if (chest.locked && keyCount < 1) {
      roomSpeech = t("chestClosed");
      bubble.textContent = roomSpeech;
      return;
    }
    const wasLocked = chest.locked;
    if (wasLocked) keyCount -= 1;
    chest.opened = true;
    chest.locked = false;
    chest.el.classList.remove("is-locked");
    chest.el.classList.add("is-open");
    purse += chest.reward;
    roomSpeech = wasLocked
      ? t("chestKeyOk", { n: chest.reward, word: nutsWord(chest.reward) })
      : t("chestReward", { n: chest.reward, word: nutsWord(chest.reward) });
    bubble.textContent = roomSpeech;
    setProgress();
    const cell = byId.get(activeId);
    if (cell && cell.kind === "secret") renderPanel(cell);
  });
}

function spendCutAnswers(teamId) {
  const pilot = pilotById(teamId) || focusPilot();
  const cell = roomAt(pilot.x, pilot.y);
  if (!cell || cell.kind !== "quiz" || pilot.done || pilot.cheering || pilot.picks.has(cell.quiz)) return;
  if (purse < CUT_COST || pilot.revealed.has(cell.quiz) || wrongLeft(cell, pilot) === 0) return;
  const gone = new Set(pilot.removed.get(cell.quiz) || []);
  const wrong = QUESTIONS[cell.quiz].choices
    .map((_, index) => index)
    .filter((index) => index !== QUESTIONS[cell.quiz].answer && !gone.has(index));
  wrong.slice(0, 2).forEach((index) => gone.add(index));
  pilot.removed.set(cell.quiz, gone);
  purse -= CUT_COST;
  roomSpeech = t("cutDone", { id: pilot.id });
  bubble.textContent = roomSpeech;
  if (focusTeam === pilot.id) renderPanel(cell, pilot);
  else setProgress();
}

function spendRevealAnswer(teamId) {
  const pilot = pilotById(teamId) || focusPilot();
  const cell = roomAt(pilot.x, pilot.y);
  if (!cell || cell.kind !== "quiz" || pilot.done || pilot.cheering || pilot.picks.has(cell.quiz)) return;
  if (purse < REVEAL_COST || pilot.revealed.has(cell.quiz)) return;
  pilot.revealed.add(cell.quiz);
  purse -= REVEAL_COST;
  roomSpeech = t("revealDone", { id: pilot.id });
  bubble.textContent = roomSpeech;
  if (focusTeam === pilot.id) renderPanel(cell, pilot);
  else setProgress();
}

let soundReady = false;

function audio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audio.ctx) {
    try {
      audio.ctx = new AudioCtx();
    } catch (error) {
      return null;
    }
  }
  if (audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});
  return audio.ctx;
}

function markSound(on) {
  soundReady = on;
  document.querySelectorAll("[data-sound]").forEach((button) => {
    button.classList.toggle("is-on", on);
    button.dataset.i18n = on ? "soundOn" : "sound";
    button.textContent = t(button.dataset.i18n);
  });
}

function unlockAudio(beep) {
  const ctx = audio();
  if (!ctx) return;
  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
  } catch (error) {
    return;
  }
  if (beep) {
    tone(523, 0, 0.08);
    tone(659, 0.1, 0.12);
    tone(784, 0.22, 0.16, "triangle", 0.06);
  }
  const done = () => {
    if (ctx.state === "running") markSound(true);
  };
  if (ctx.state === "running") done();
  else ctx.resume().then(done).catch(() => {});
}

function tone(freq, start, dur, type = "square", volume = 0.07) {
  const ctx = audio();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
    amp.gain.setValueAtTime(volume, ctx.currentTime + start);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + dur + 0.02);
  } catch (error) {}
}

function playCheer() {
  for (let pass = 0; pass < 3; pass += 1) {
    const beat = pass * 2;
    tone(523, beat, 0.1);
    tone(659, beat + 0.5, 0.1);
    tone(392, beat + 1, 0.16);
    tone(784, beat + 1.5, 0.08);
    tone(880, beat + 1.72, 0.12);
  }
}

function playMiss() {
  tone(196, 0, 0.16, "sawtooth", 0.05);
  tone(146, 0.14, 0.22, "sawtooth", 0.05);
}

function playWin() {
  tone(523, 0, 0.07);
  tone(659, 0.16, 0.07);
  tone(784, 0.32, 0.08);
  tone(1046, 0.08, 0.07, "triangle", 0.06);
  tone(1318, 0.16, 0.07, "triangle", 0.05);
  tone(1568, 0.24, 0.08, "triangle", 0.05);
  tone(1174, 0.34, 0.1, "triangle", 0.04);
  tone(440, 2, 0.28, "triangle", 0.05);
  tone(554, 3.1, 0.32, "triangle", 0.05);
  tone(523, 4, 0.1);
  tone(659, 4.5, 0.1);
  tone(392, 5, 0.16);
  tone(784, 5.5, 0.08);
  tone(880, 5.72, 0.14);
}

function playSplat() {
  const ctx = audio();
  if (!ctx) return;
  try {
    const length = Math.floor(ctx.sampleRate * 0.28);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    src.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.26);
    amp.gain.setValueAtTime(0.45, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(ctx.destination);
    src.start();
  } catch (error) {}
  tone(90, 0, 0.18, "sine", 0.12);
  tone(140, 0.04, 0.12, "triangle", 0.06);
}

function playFail() {
  tone(220, 0, 0.2, "sawtooth", 0.05);
  tone(174, 0.18, 0.2, "sawtooth", 0.05);
  tone(130, 0.36, 0.3, "sawtooth", 0.05);
}

function cheer(pilot, done) {
  pilot.cheering = true;
  pilot.moving = false;
  pilot.el.classList.remove("walking", "is-cheering");
  void pilot.el.offsetWidth;
  pilot.el.classList.add("is-cheering");
  playCheer();
  const other = pilots.find((item) => item.id !== pilot.id);
  roomSpeech = `${t("dancing", { id: pilot.id })}${other && !other.done ? t("canWalk", { id: other.id }) : ""}`;
  bubble.textContent = roomSpeech;
  window.setTimeout(() => {
    pilot.el.classList.remove("is-cheering");
    pilot.cheering = false;
    if (!pilot.done && done) done();
  }, 6000);
}

function packQuestion(pilot) {
  const cell = roomAt(pilot.x, pilot.y);
  const payload = {
    quiz: null,
    title: t("teamTitle", { id: pilot.id }),
    prompt: t("walkToQuestion"),
    choices: [],
    answered: true,
    purse,
    cutOk: false,
    revealOk: false,
  };
  if (pilot.done) {
    payload.prompt = pilot.el.classList.contains("is-dancing") ? t("finishDance") : t("finishBroken");
    return payload;
  }
  if (!cell || cell.kind !== "quiz") return payload;
  const quiz = QUESTIONS[cell.quiz];
  const gone = pilot.removed.get(cell.quiz) || new Set();
  const answered = pilot.picks.has(cell.quiz);
  payload.quiz = cell.quiz;
  payload.title = quiz.title;
  payload.prompt = quiz.prompt;
  payload.answered = answered || pilot.cheering;
  payload.choices = quiz.choices.map((text, index) => ({
    index,
      text: gone.has(index) ? t("hidden") : text,
    cut: gone.has(index),
  }));
  payload.cutOk = !answered && !pilot.cheering && purse >= CUT_COST && wrongLeft(cell, pilot) > 0 && !pilot.revealed.has(cell.quiz);
  payload.revealOk = !answered && !pilot.cheering && purse >= REVEAL_COST && !pilot.revealed.has(cell.quiz);
  payload.reveal = !answered && pilot.revealed.has(cell.quiz) ? quiz.answer : null;
  return payload;
}

function publishQuestions() {
  fetch("/api/question", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game: GAME, teams: { 1: packQuestion(pilots[0]), 2: packQuestion(pilots[1]) } }),
  }).catch(() => {});
}

function applyRemoteShops(list) {
  let newest = seenShop;
  (list || []).forEach((item) => {
    if (!item || item.id <= seenShop || ended) return;
    const pilot = pilotById(item.team);
    if (!pilot || pilot.cheering) return;
    newest = Math.max(newest, item.id);
    if (item.action === "cut") spendCutAnswers(item.team);
    if (item.action === "reveal") spendRevealAnswer(item.team);
  });
  seenShop = newest;
}

function applyRemoteAnswers(list) {
  let newest = seenAnswer;
  (list || []).forEach((item) => {
    if (!item || item.id <= seenAnswer || ended) return;
    const pilot = pilotById(item.team);
    if (!pilot || pilot.cheering) return;
    const cell = CELLS.find((room) => room.kind === "quiz" && room.quiz === item.quiz);
    if (!cell || pilot.done || pilot.picks.has(cell.quiz)) {
      newest = Math.max(newest, item.id);
      return;
    }
    const here = roomAt(pilot.x, pilot.y);
    if (!here || here.id !== cell.id) return;
    newest = Math.max(newest, item.id);
    const button = focusTeam === pilot.id ? answers.querySelectorAll("button")[item.index] : null;
    choose(cell, item.index, button, item.team);
  });
  seenAnswer = newest;
}

function choose(cell, index, button, team) {
  const pilot = pilotById(team) || pilots.find((item) => roomAt(item.x, item.y)?.id === cell.id && !item.picks.has(cell.quiz) && !item.done);
  if (!pilot || pilot.done || pilot.cheering || cell.kind !== "quiz" || pilot.picks.has(cell.quiz)) return;
  const here = roomAt(pilot.x, pilot.y);
  if (!here || here.id !== cell.id) return;
  const quiz = QUESTIONS[cell.quiz];
  const ok = index === quiz.answer;
  pilot.picks.set(cell.quiz, index);
  pilot.results.set(cell.quiz, ok);
  if (ok) pilot.correctCount += 1;
  else purse = Math.max(0, purse - PENALTY);
  pilot.passed.add(cell.id);
  if (button) button.disabled = true;
  paintDoors();
  setProgress();
  if (focusTeam === pilot.id) {
    feedback.textContent = ok ? t("feedbackOk", { id: pilot.id }) : t("feedbackBad", { id: pilot.id, n: purse });
    renderPanel(cell, pilot);
  }
  const lastQuiz = cell.quiz === QUESTIONS.length - 1;
  if (ok) cheer(pilot, () => (lastQuiz ? finishPilot(pilot) : openForward(pilot, cell)));
  else {
    playMiss();
    if (lastQuiz) finishPilot(pilot);
    else openForward(pilot, cell);
  }
}

function clearFx() {
  fx.replaceChildren();
}

function burstConfetti() {
  clearFx();
  const colors = ["#5eead4", "#f5c16c", "#ff5d8f", "#7ee0ff", "#d6ff4a", "#ffffff"];
  const height = mazeWrap.clientHeight || 420;
  for (let i = 0; i < 52; i += 1) {
    const bit = document.createElement("i");
    bit.className = "bit";
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = colors[i % colors.length];
    bit.style.width = `${6 + Math.random() * 7}px`;
    bit.style.height = `${9 + Math.random() * 10}px`;
    bit.style.setProperty("--dx", `${(Math.random() - 0.5) * 140}px`);
    bit.style.setProperty("--dy", `${height * (0.25 + Math.random() * 0.62)}px`);
    bit.style.setProperty("--spin", `${Math.random() * 720 - 360}deg`);
    bit.style.animationDelay = `${Math.random() * 0.28}s`;
    fx.appendChild(bit);
  }
}

function burstOil(target) {
  clearFx();
  const wrap = mazeWrap.getBoundingClientRect();
  const bot = (target || robot).getBoundingClientRect();
  const cx = bot.left + bot.width / 2 - wrap.left;
  const cy = bot.top + bot.height * 0.4 - wrap.top;
  for (let i = 0; i < 28; i += 1) {
    const drop = document.createElement("i");
    drop.className = "drop";
    const angle = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 120;
    drop.style.left = `${cx}px`;
    drop.style.top = `${cy}px`;
    drop.style.width = `${6 + Math.random() * 12}px`;
    drop.style.height = `${8 + Math.random() * 16}px`;
    drop.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    drop.style.setProperty("--dy", `${Math.sin(angle) * dist * 0.62}px`);
    fx.appendChild(drop);
  }
}

function finishPilot(pilot) {
  pilot.done = true;
  pilot.cheering = false;
  pilot.moving = false;
  pilot.el.classList.remove("walking", "is-cheering");
  const ratio = pilot.correctCount / QUESTIONS.length;
  const win = ratio >= 0.7;
  const percent = Math.round(ratio * 100);
  setProgress();
  status.textContent = t("percentStatus", { id: pilot.id, percent });
  if (win) {
    pilot.el.classList.add("is-dancing");
    dance.hidden = false;
    dance.textContent = t("danceBanner", { id: pilot.id });
    burstConfetti();
    playWin();
    roomSpeech = t("winSpeech", { id: pilot.id, percent });
  } else {
    pilot.el.classList.add("is-broken");
    crash.hidden = false;
    crash.textContent = t("crashBanner", { id: pilot.id });
    burstOil(pilot.el);
    playFail();
    playSplat();
    roomSpeech = t("loseSpeech", { id: pilot.id, percent });
  }
  bubble.textContent = roomSpeech;
  feedback.textContent = t("finaleCount", { id: pilot.id, n: pilot.correctCount, total: QUESTIONS.length });
  if (pilots.every((item) => item.done)) {
    ended = true;
    restart.hidden = false;
  }
}

function resetRun() {
  ended = false;
  passed.clear();
  seen.clear();
  results.clear();
  picks.clear();
  removed.clear();
  revealed.clear();
  correctCount = 0;
  purse = 0;
  keyCount = 0;
  keys.clear();
  focusTeam = "1";
  seenAnswer = 0;
  seenShop = 0;
  fetch("/api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game: GAME }),
  }).catch(() => {});
  pilots.forEach((pilot) => {
    Object.assign(pilot, blankLog());
    pilot.el.classList.remove("is-broken", "is-dancing", "is-cheering", "walking");
  });
  coins.forEach((coin) => {
    coin.taken = false;
    coin.el.classList.remove("is-taken");
  });
  keyPickups.forEach((item) => {
    item.taken = false;
    item.el.classList.remove("is-taken");
  });
  chests.forEach((chest) => {
    chest.opened = false;
    chest.locked = chest.originalLocked;
    chest.el.classList.remove("is-open");
    chest.el.classList.toggle("is-locked", chest.originalLocked);
  });
  mazeWrap.classList.remove("is-broken");
  clearFx();
  crash.hidden = true;
  dance.hidden = true;
  restart.hidden = true;
  placeAtStart();
  activeId = 0;
  enter(CELLS[0]);
  paintDoors();
  setProgress();
}

function updateCamera() {
  const viewW = mazeWrap.clientWidth;
  const viewH = mazeWrap.clientHeight;
  const span = Math.max(Math.abs(pilots[0].x - pilots[1].x), Math.abs(pilots[0].y - pilots[1].y), ROOM);
  const scale = Math.min(1.5, Math.max(0.45, (viewH - 24) / (span + 150)));
  const cx = (pilots[0].x + pilots[1].x) / 2;
  const cy = (pilots[0].y + pilots[1].y) / 2;
  let ox = viewW * 0.5 - cx * scale;
  let oy = viewH * 0.46 - cy * scale;
  ox = Math.max(viewW - MAZE_W * scale - 8, Math.min(8, ox));
  oy = Math.max(viewH - MAZE_H * scale - 8, Math.min(8, oy));
  maze.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
}

function pressed(names) {
  return names.some((name) => keys.has(name));
}

const keyToPad = {
  w: [1, "up"],
  a: [1, "left"],
  s: [1, "down"],
  d: [1, "right"],
  arrowup: [2, "up"],
  arrowleft: [2, "left"],
  arrowdown: [2, "down"],
  arrowright: [2, "right"],
};

window.addEventListener("keydown", (event) => {
  if (ended) return;
  const mapped = keyToPad[event.key.toLowerCase()];
  if (mapped) {
    localPad[mapped[0]][mapped[1]] = true;
    event.preventDefault();
    return;
  }
  if (["1", "2", "3", "4"].includes(event.key)) {
    const button = answers.querySelectorAll("button")[Number(event.key) - 1];
    if (button && !button.disabled) button.click();
  }
});

window.addEventListener("keyup", (event) => {
  const mapped = keyToPad[event.key.toLowerCase()];
  if (mapped) localPad[mapped[0]][mapped[1]] = false;
});

window.addEventListener("resize", updateCamera);
restart.addEventListener("click", resetRun);
spendCut.addEventListener("click", spendCutAnswers);
spendReveal.addEventListener("click", spendRevealAnswer);

function movePilot(pilot, dx, dy, dt) {
  const length = Math.hypot(dx, dy) || 1;
  const nx = pilot.x + (dx / length) * SPEED * dt;
  const ny = pilot.y + (dy / length) * SPEED * dt;
  if (walkable(nx, ny, pilot)) {
    pilot.x = nx;
    pilot.y = ny;
    return "";
  }
  let slid = false;
  if (dx !== 0 && walkable(nx, pilot.y, pilot)) {
    pilot.x = nx;
    slid = true;
  }
  if (dy !== 0 && walkable(pilot.x, ny, pilot)) {
    pilot.y = ny;
    slid = true;
  }
  if (slid) return "";
  return touchesLocked(nx, ny, pilot) ? "door" : "wall";
}

function pilotDir(pilot, dir) {
  return Boolean(pads[pilot.id][dir] || localPad[pilot.id][dir]);
}

function paintPilot(pilot) {
  pilot.el.style.left = `${pilot.x}px`;
  pilot.el.style.top = `${pilot.y}px`;
  pilot.el.classList.toggle("walking", pilot.moving && !pilot.done && !pilot.cheering);
  pilot.el.classList.toggle("face-left", pilot.facing < 0 && !pilot.done);
  pilot.el.classList.toggle("is-cheering", pilot.cheering);
  if (!pilot.done) pilot.sprite.style.transform = `scaleX(${pilot.facing})`;
}

function whereName(pilot) {
  const cell = roomAt(pilot.x, pilot.y);
  if (!cell) return t("corridor");
  if (cell.kind === "secret") return t("secretShort");
  return QUESTIONS[cell.quiz].code;
}

function followRoute(dt) {
  const target = route[0];
  const dx = target.x - x;
  const dy = target.y - y;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) {
    x = target.x;
    y = target.y;
    route.shift();
    return;
  }
  const step = Math.min(dist, SPEED * dt);
  const nx = x + (dx / dist) * step;
  const ny = y + (dy / dist) * step;
  if (walkable(nx, ny)) {
    x = nx;
    y = ny;
  } else if (walkable(nx, y)) {
    x = nx;
  } else if (walkable(x, ny)) {
    y = ny;
  }
  if (dx < 0) facing = -1;
  if (dx > 0) facing = 1;
}

function frame(now) {
  const dt = Math.min(0.032, (now - last) / 1000);
  last = now;
  let blocked = "";
  pilots.forEach((pilot) => {
    if (pilot.done || pilot.cheering) {
      pilot.moving = false;
      paintPilot(pilot);
      return;
    }
    let dx = 0;
    let dy = 0;
    if (pilotDir(pilot, "left")) dx -= 1;
    if (pilotDir(pilot, "right")) dx += 1;
    if (pilotDir(pilot, "up")) dy -= 1;
    if (pilotDir(pilot, "down")) dy += 1;
    pilot.moving = dx !== 0 || dy !== 0;
    if (pilot.moving) {
      const hit = movePilot(pilot, dx, dy, dt);
      if (hit) blocked = hit === "door" ? t("doorBlock", { id: pilot.id }) : t("wallBlock", { id: pilot.id });
      if (dx < 0) pilot.facing = -1;
      if (dx > 0) pilot.facing = 1;
    }
    const here = roomAt(pilot.x, pilot.y);
    if (here && here.id !== pilot.roomId) {
      pilot.roomId = here.id;
      focusQuestion(here, pilot);
    }
    paintPilot(pilot);
  });

  if (!ended && blocked) {
    bubble.textContent = blocked;
  } else if (!ended && !pilots.some((pilot) => pilot.moving || pilot.cheering)) {
    bubble.textContent = roomSpeech;
  }

  if (teamWhere) {
    const live = (id) => (pads[id].connected ? t("linked") : t("waitQr"));
    teamWhere.textContent = `1 ${whereName(pilots[0])} · ${live(1)} · 2 ${whereName(pilots[1])} · ${live(2)}`;
  }

  collectCoins();
  updateCamera();
  requestAnimationFrame(frame);
}

function drawQr(id, text) {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  document.getElementById(id).innerHTML = code.createSvgTag(3, 1);
}

function paintControllerQr() {
  if (!hostOrigin || qrReady) return;
  qrReady = true;
  const room = LINK ? `&room=${encodeURIComponent(LINK)}` : "";
  drawQr("qr-1", `${hostOrigin}/control.html?team=1&game=${encodeURIComponent(GAME)}${room}`);
  drawQr("qr-2", `${hostOrigin}/control.html?team=2&game=${encodeURIComponent(GAME)}${room}`);
}

async function pollPads() {
  try {
    const res = await fetch(`/api/pad?game=${encodeURIComponent(GAME)}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    pads[1] = data.pads["1"];
    pads[2] = data.pads["2"];
    hostOrigin = data.origin || hostOrigin;
    applyRemoteAnswers(data.answers);
    applyRemoteShops(data.shops);
    paintControllerQr();
    const both = pads[1].connected && pads[2].connected;
    document.getElementById("phones").classList.toggle("is-ready", both && qrReady);
  } catch (error) {
    pads[1] = { up: false, down: false, left: false, right: false, connected: false };
    pads[2] = { up: false, down: false, left: false, right: false, connected: false };
  }
}

async function bootGame() {
  await fetch("/api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game: GAME }),
  }).catch(() => {});
  seenAnswer = 0;
  seenShop = 0;
  pollPads();
  window.setInterval(pollPads, 80);
  prepareLayout();
  const kicker = document.querySelector(".brand-kicker");
  if (kicker) kicker.textContent = `${GAME} · ${QUESTIONS.length} ${t("sectors")}`;
  buildMaze();
  placeAtStart();
  enter(CELLS[0]);
  paintDoors();
  setProgress();
  updateCamera();
  requestAnimationFrame(frame);
}

const gate = document.getElementById("gate");
const gateNote = document.getElementById("gate-note");
const gameCodeInput = document.getElementById("game-code");

async function enterGame(raw) {
  const code = String(raw || "").trim().toUpperCase();
  gateNote.textContent = "";
  gateNote.classList.remove("is-bad");
  const res = await fetch(`/api/quiz?code=${encodeURIComponent(code)}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.rooms)) {
    gateNote.textContent = t("noCode");
    gateNote.classList.add("is-bad");
    return;
  }
  GAME = data.code || code;
  QUESTIONS = data.rooms;
  gate.hidden = true;
  if (!LINK) LINK = Math.random().toString(36).slice(2, 8);
  const folder = location.pathname.replace(/[^/]*$/, "");
  history.replaceState(null, "", `${folder}?code=${encodeURIComponent(GAME)}&room=${encodeURIComponent(LINK)}`);
  bootGame();
}

gate.addEventListener("submit", (event) => {
  event.preventDefault();
  unlockAudio(true);
  enterGame(gameCodeInput.value);
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sound]");
  if (!button) return;
  unlockAudio(true);
});

window.addEventListener("pointerdown", () => {
  if (!soundReady) unlockAudio(false);
});
window.addEventListener("keydown", () => {
  if (!soundReady) unlockAudio(false);
});
window.addEventListener("q-lang", () => markSound(soundReady));

const preset = new URLSearchParams(location.search).get("code");
if (preset) {
  gameCodeInput.value = preset;
  enterGame(preset);
}

window.addEventListener("q-lang", () => {
  document.querySelectorAll(".room.is-secret .room-code").forEach((el) => {
    el.textContent = t("chestTag");
  });
  if (!GAME || !CELLS.length) {
    purseLabel.textContent = t("nuts", { n: purse });
    keyLabel.textContent = t("keys", { n: keyCount });
    return;
  }
  const kicker = document.querySelector(".brand-kicker");
  if (kicker) kicker.textContent = `${GAME} · ${QUESTIONS.length} ${t("sectors")}`;
  setProgress();
  const cell = byId.get(activeId);
  if (cell) enter(cell, focusPilot());
});
