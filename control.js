const params = new URLSearchParams(location.search);
const team = params.get("team") === "2" ? "2" : "1";
const game = (params.get("game") || "").trim().toUpperCase();
const held = { up: false, down: false, left: false, right: false };
let lastQuestion = null;

document.body.classList.add(team === "2" ? "team-2" : "team-1");
function paintTeam() {
  document.getElementById("team").textContent = t("phoneTeam", { id: team });
  document.getElementById("link").textContent = team === "1" ? t("mint") : t("amber");
  document.getElementById("nuts").textContent = t("phoneShop", { n: lastQuestion && lastQuestion.purse ? lastQuestion.purse : 0 });
  document.getElementById("buy-cut").textContent = t("phoneCut");
  document.getElementById("buy-reveal").textContent = t("phoneReveal");
  const waiting = document.getElementById("prompt");
  if (!game) waiting.textContent = t("phoneQr");
  else if (!lastQuestion || !lastQuestion.prompt) waiting.textContent = t("phoneWait");
}
paintTeam();

function send() {
  fetch("/api/pad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game, team, ...held }),
  }).catch(() => {
    document.getElementById("link").textContent = t("noScreen");
  });
}

document.querySelectorAll(".dpad button").forEach((button) => {
  const dir = button.dataset.dir;
  const press = (event) => {
    event.preventDefault();
    held[dir] = true;
    button.classList.add("is-held");
    if (button.setPointerCapture) button.setPointerCapture(event.pointerId);
    send();
  };
  const release = (event) => {
    if (event) event.preventDefault();
    if (!held[dir]) return;
    held[dir] = false;
    button.classList.remove("is-held");
    send();
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
});

window.setInterval(send, 400);
send();

const prompt = document.getElementById("prompt");
const choices = document.getElementById("choices");
let shown = "";

function buy(action) {
  fetch("/api/shop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game, team, action }),
  }).catch(() => {
    document.getElementById("link").textContent = t("shopFail");
  });
}

document.getElementById("buy-cut").addEventListener("click", () => buy("cut"));
document.getElementById("buy-reveal").addEventListener("click", () => buy("reveal"));

function paintQuestion(data, force) {
  lastQuestion = data;
  const key = JSON.stringify(data) + currentLang;
  const nuts = document.getElementById("nuts");
  const cut = document.getElementById("buy-cut");
  const reveal = document.getElementById("buy-reveal");
  nuts.textContent = t("phoneShop", { n: data && data.purse ? data.purse : 0 });
  cut.textContent = t("phoneCut");
  reveal.textContent = t("phoneReveal");
  cut.disabled = !(data && data.cutOk);
  reveal.disabled = !(data && data.revealOk);
  if (!force && key === shown) return;
  shown = key;
  prompt.textContent = data && data.prompt ? data.prompt : t("phoneReach");
  choices.replaceChildren();
  (data && data.choices ? data.choices : []).forEach((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${choice.index + 1}. ${choice.text}`;
    button.disabled = Boolean(data.answered || choice.cut);
    button.addEventListener("click", () => {
      if (button.disabled || data.quiz === null || data.quiz === undefined) return;
      button.disabled = true;
      fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game, team, quiz: data.quiz, index: choice.index }),
      }).catch(() => {
        document.getElementById("link").textContent = t("answerFail");
      });
    });
    choices.appendChild(button);
  });
}

async function pollQuestion() {
  try {
    const res = await fetch(`/api/question?team=${team}&game=${encodeURIComponent(game)}`, { cache: "no-store" });
    if (!res.ok) return;
    paintQuestion(await res.json());
  } catch (error) {
    document.getElementById("link").textContent = t("noScreen");
  }
}

window.setInterval(pollQuestion, 400);
pollQuestion();

window.addEventListener("q-lang", () => {
  paintTeam();
  if (lastQuestion) paintQuestion(lastQuestion, true);
});
