const openForm = document.getElementById("open");
const bank = document.getElementById("bank");
const cards = document.getElementById("cards");
const openNote = document.getElementById("open-note");
const saveNote = document.getElementById("save-note");
const playCode = document.getElementById("play-code");
const codeValue = document.getElementById("code-value");
const playHint = document.getElementById("play-hint");
const saveButton = document.getElementById("save-rooms");
const newMaze = document.getElementById("new-maze");

let savedCode = "";

function note(el, text, kind) {
  el.textContent = text;
  el.classList.toggle("is-ok", kind === "ok");
  el.classList.toggle("is-bad", kind === "bad");
}

function field(label, value, name) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const input = document.createElement("input");
  input.name = name;
  input.value = value;
  input.required = true;
  wrap.appendChild(input);
  return wrap;
}

const MIN_ROOMS = 5;
const MAX_ROOMS = 15;

function blankRoom(index) {
  return {
    code: `Q${index + 1}`,
    title: t("blankTitle", { n: index + 1 }),
    prompt: t("blankPrompt"),
    choices: [1, 2, 3, 4].map((n) => t("variant", { n })),
    answer: 0,
    hint: "",
  };
}

function syncRoomButtons() {
  const count = cards.querySelectorAll(".quiz-card").length;
  const add = document.getElementById("add-room");
  if (add) add.disabled = count >= MAX_ROOMS;
  cards.querySelectorAll(".remove-room").forEach((button) => {
    button.disabled = count <= MIN_ROOMS;
  });
  const countNote = document.getElementById("room-count");
  if (countNote) countNote.textContent = t("countOf", { n: count, min: MIN_ROOMS, max: MAX_ROOMS });
}

function paint(rooms) {
  cards.replaceChildren();
  rooms.forEach((room, index) => {
    const card = document.createElement("section");
    card.className = "quiz-card";
    card.dataset.index = String(index);
    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("p");
    title.className = "room-kicker";
    title.textContent = t("questionN", { n: String(index + 1).padStart(2, "0") });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-room";
    remove.textContent = t("remove");
    remove.addEventListener("click", () => {
      const next = collect();
      if (next.length <= MIN_ROOMS) return;
      next.splice(index, 1);
      paint(next);
    });
    head.append(title, remove);
    card.appendChild(head);
    card.appendChild(field(t("mapCode"), room.code || "", "code"));
    card.appendChild(field(t("name"), room.title || "", "title"));
    const prompt = document.createElement("label");
    prompt.append(t("prompt"));
    const area = document.createElement("textarea");
    area.name = "prompt";
    area.rows = 2;
    area.required = true;
    area.value = room.prompt || "";
    prompt.appendChild(area);
    card.appendChild(prompt);
    const choices = room.choices || ["", "", "", ""];
    choices.forEach((choice, choiceIndex) => {
      const row = document.createElement("div");
      row.className = "choice-row";
      const mark = document.createElement("input");
      mark.type = "radio";
      mark.name = `answer-${index}`;
      mark.value = String(choiceIndex);
      mark.checked = room.answer === choiceIndex;
      mark.required = true;
      const text = document.createElement("input");
      text.name = `choice-${choiceIndex}`;
      text.value = choice;
      text.required = true;
      text.setAttribute("aria-label", t("answerN", { n: choiceIndex + 1 }));
      row.append(mark, text);
      card.appendChild(row);
    });
    const hint = document.createElement("label");
    hint.append(t("hint"));
    const hintInput = document.createElement("input");
    hintInput.name = "hint";
    hintInput.value = room.hint || "";
    hint.appendChild(hintInput);
    card.appendChild(hint);
    cards.appendChild(card);
  });
  syncRoomButtons();
}

function collect() {
  return [...cards.querySelectorAll(".quiz-card")].map((card, index) => {
    const value = (name) => card.querySelector(`[name="${name}"]`).value.trim();
    const answer = card.querySelector(`input[name="answer-${index}"]:checked`);
    return {
      code: value("code"),
      title: value("title"),
      prompt: value("prompt"),
      choices: [0, 1, 2, 3].map((choice) => value(`choice-${choice}`)),
      answer: answer ? Number(answer.value) : 0,
      hint: value("hint"),
    };
  });
}

function showSaved(code) {
  savedCode = code;
  codeValue.textContent = code;
  playCode.hidden = false;
  playHint.hidden = true;
  openForm.hidden = true;
  newMaze.hidden = false;
  saveButton.textContent = t("save");
}

function showDraft() {
  savedCode = "";
  playCode.hidden = true;
  playHint.hidden = false;
  openForm.hidden = false;
  newMaze.hidden = true;
  saveButton.textContent = t("saveNew");
  paint(Array.from({ length: MIN_ROOMS }, (_, index) => blankRoom(index)));
}

openForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  note(openNote, "");
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: document.getElementById("open-code").value,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    note(openNote, t("failOpen"), "bad");
    return;
  }
  const mine = await fetch("/api/mine", { cache: "no-store" });
  const owned = await mine.json();
  paint(owned.rooms || []);
  showSaved(owned.code || data.code);
  note(saveNote, t("opened"), "ok");
});

bank.addEventListener("submit", async (event) => {
  event.preventDefault();
  note(saveNote, "");
  const rooms = collect();
  const res = savedCode
    ? await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rooms }),
      })
    : await fetch("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rooms }),
      });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    note(saveNote, t("failSave"), "bad");
    return;
  }
  showSaved(data.code);
  note(saveNote, t("savedCode", { code: data.code }), "ok");
});

document.getElementById("add-room").addEventListener("click", () => {
  const rooms = collect();
  if (rooms.length >= MAX_ROOMS) return;
  rooms.push(blankRoom(rooms.length));
  paint(rooms);
});

newMaze.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  document.getElementById("open-code").value = "";
  note(openNote, "");
  note(saveNote, "");
  showDraft();
});

showDraft();

fetch("/api/session", { cache: "no-store" })
  .then((res) => res.json())
  .then(async (data) => {
    if (!data.ok) return;
    const mine = await fetch("/api/mine", { cache: "no-store" });
    if (!mine.ok) return;
    const owned = await mine.json();
    paint(owned.rooms || []);
    showSaved(owned.code);
  })
  .catch(() => {});

window.addEventListener("q-lang", () => {
  saveButton.textContent = savedCode ? t("save") : t("saveNew");
  if (!cards.querySelector(".quiz-card")) return;
  paint(collect());
});
