/* На github.io нет Python-сервера: те же /api/* живут в этом браузере. */
(function () {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return;
  if (!host.endsWith("github.io")) return;

  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const GAMES = "q-pages-games";
  const RUNS = "q-pages-runs";
  const SESSION = "q-pages-session";

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}");
    } catch (error) {
      return {};
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clean(value) {
    const code = String(value || "").trim().toUpperCase();
    if (code.length !== 6 || [...code].some((char) => !ALPHA.includes(char))) return "";
    return code;
  }

  function freshCode(games) {
    for (let i = 0; i < 30; i += 1) {
      const code = Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join("");
      if (!games[code]) return code;
    }
    return `Q${Date.now().toString(36).slice(-5).toUpperCase()}`.slice(0, 6);
  }

  function normalize(raw) {
    if (!Array.isArray(raw) || raw.length < 5 || raw.length > 15) return null;
    const rooms = [];
    for (let index = 0; index < raw.length; index += 1) {
      const item = raw[index];
      if (!item || !Array.isArray(item.choices) || item.choices.length !== 4) return null;
      const choices = item.choices.map((choice) => String(choice).trim().slice(0, 160));
      if (choices.some((choice) => !choice)) return null;
      const answer = item.answer;
      if (typeof answer !== "number" || answer < 0 || answer > 3) return null;
      const code = String(item.code || "").trim().slice(0, 12);
      const title = String(item.title || "").trim().slice(0, 48);
      const prompt = String(item.prompt || "").trim().slice(0, 300);
      const hint = String(item.hint || "").trim().slice(0, 300);
      if (!code || !title || !prompt) return null;
      rooms.push({ id: index + 1, code, title, x: index, y: 0, prompt, choices, answer, hint });
    }
    return rooms;
  }

  function blankRun() {
    return {
      pads: {
        1: { up: false, down: false, left: false, right: false, seen: 0 },
        2: { up: false, down: false, left: false, right: false, seen: 0 },
      },
      question: {
        1: { quiz: null, title: "", prompt: "", choices: [], answered: false, purse: 0, cutOk: false, revealOk: false },
        2: { quiz: null, title: "", prompt: "", choices: [], answered: false, purse: 0, cutOk: false, revealOk: false },
      },
      answers: [],
      answerSeq: 0,
      shops: [],
      shopSeq: 0,
    };
  }

  function padView(pad) {
    const age = (Date.now() - pad.seen) / 1000;
    const held = age < 1.6;
    return {
      up: held && Boolean(pad.up),
      down: held && Boolean(pad.down),
      left: held && Boolean(pad.left),
      right: held && Boolean(pad.right),
      connected: age < 4,
    };
  }

  function siteOrigin() {
    const folder = location.pathname.replace(/[^/]*$/, "");
    return location.origin + folder.replace(/\/$/, "");
  }

  function reply(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function seed() {
    const games = read(GAMES);
    let changed = false;
    if (!games.QSTART && Array.isArray(window.ROOMS)) {
      const rooms = normalize(window.ROOMS);
      if (rooms) {
        games.QSTART = { rooms };
        changed = true;
      }
    }
    if (!games.RQHJQ5 && Array.isArray(window.SECURITY)) {
      const rooms = normalize(window.SECURITY);
      if (rooms) {
        games.RQHJQ5 = { rooms };
        changed = true;
      }
    }
    if (changed) write(GAMES, games);
  }

  const original = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return original(input, init);
    seed();
    const method = ((init && init.method) || "GET").toUpperCase();
    let data = {};
    if (init && init.body) {
      try {
        data = JSON.parse(init.body);
      } catch (error) {
        data = {};
      }
    }
    const games = read(GAMES);
    const runs = read(RUNS);
    const path = url.pathname;
    const queryCode = clean(url.searchParams.get("code") || url.searchParams.get("game"));

    if (method === "GET" && path === "/api/quiz") {
      const game = games[queryCode];
      if (!game) return reply({ ok: false, error: "Нет такого кода" }, 404);
      return reply({ ok: true, code: queryCode, rooms: game.rooms || [] });
    }
    if (method === "GET" && path === "/api/session") {
      const code = clean(localStorage.getItem(SESSION));
      return reply({ ok: Boolean(games[code]), code: games[code] ? code : "" });
    }
    if (method === "GET" && path === "/api/mine") {
      const code = clean(localStorage.getItem(SESSION));
      if (!games[code]) return reply({ ok: false }, 401);
      return reply({ ok: true, code, rooms: games[code].rooms || [] });
    }
    if (method === "GET" && path === "/api/pad") {
      if (!games[queryCode]) return reply({ ok: false, error: "Нет такого кода" }, 404);
      const run = runs[queryCode] || blankRun();
      return reply({
        origin: siteOrigin(),
        pads: { 1: padView(run.pads[1]), 2: padView(run.pads[2]) },
        answers: run.answers,
        shops: run.shops,
      });
    }
    if (method === "GET" && path === "/api/question") {
      if (!games[queryCode]) return reply({ ok: false, error: "Нет такого кода" }, 404);
      const run = runs[queryCode] || blankRun();
      const team = url.searchParams.get("team") === "2" ? "2" : "1";
      return reply(run.question[team]);
    }
    if (method === "POST" && path === "/api/create") {
      const rooms = normalize(data.rooms);
      if (!rooms) return reply({ ok: false, error: "Нужно от 5 до 15 вопросов, у каждого 4 ответа и один верный" }, 400);
      const code = freshCode(games);
      games[code] = { rooms };
      write(GAMES, games);
      localStorage.setItem(SESSION, code);
      return reply({ ok: true, code });
    }
    if (method === "POST" && path === "/api/login") {
      const code = clean(data.code);
      if (!games[code]) return reply({ ok: false, error: "Нет такого кода" }, 404);
      localStorage.setItem(SESSION, code);
      return reply({ ok: true, code });
    }
    if (method === "POST" && path === "/api/logout") {
      localStorage.removeItem(SESSION);
      return reply({ ok: true });
    }
    if (method === "POST" && path === "/api/quiz") {
      const code = clean(localStorage.getItem(SESSION));
      if (!games[code]) return reply({ ok: false, error: "Сначала сохраните лабиринт" }, 401);
      const rooms = normalize(data.rooms);
      if (!rooms) return reply({ ok: false, error: "Нужно от 5 до 15 вопросов, у каждого 4 ответа и один верный" }, 400);
      games[code].rooms = rooms;
      write(GAMES, games);
      return reply({ ok: true, code });
    }

    const code = clean(data.game || data.code || queryCode);
    if (!games[code]) return reply({ ok: false, error: "Нет такого кода" }, 404);
    const run = runs[code] || blankRun();
    if (method === "POST" && path === "/api/reset") {
      runs[code] = blankRun();
      write(RUNS, runs);
      return reply({ ok: true });
    }
    if (method === "POST" && path === "/api/question") {
      const teams = data.teams && typeof data.teams === "object" ? data.teams : { 1: data, 2: data };
      ["1", "2"].forEach((key) => {
        const item = teams[key];
        if (!item || typeof item !== "object") return;
        run.question[key] = {
          quiz: item.quiz,
          title: String(item.title || ""),
          prompt: String(item.prompt || ""),
          choices: Array.isArray(item.choices) ? item.choices : [],
          answered: Boolean(item.answered),
          purse: Number(item.purse) || 0,
          cutOk: Boolean(item.cutOk),
          revealOk: Boolean(item.revealOk),
        };
      });
      runs[code] = run;
      write(RUNS, runs);
      return reply({ ok: true });
    }
    if (method === "POST" && path === "/api/answer") {
      const team = String(data.team || "");
      if (!run.pads[team] || typeof data.quiz !== "number" || typeof data.index !== "number") return reply({ ok: false }, 400);
      run.answerSeq += 1;
      run.answers.push({ id: run.answerSeq, team, quiz: data.quiz, index: data.index });
      run.answers = run.answers.slice(-20);
      runs[code] = run;
      write(RUNS, runs);
      return reply({ ok: true });
    }
    if (method === "POST" && path === "/api/shop") {
      const team = String(data.team || "");
      if (!run.pads[team] || (data.action !== "cut" && data.action !== "reveal")) return reply({ ok: false }, 400);
      run.shopSeq += 1;
      run.shops.push({ id: run.shopSeq, team, action: data.action });
      run.shops = run.shops.slice(-20);
      runs[code] = run;
      write(RUNS, runs);
      return reply({ ok: true });
    }
    if (method === "POST" && path === "/api/pad") {
      const team = String(data.team || "");
      if (!run.pads[team]) return reply({ ok: false }, 400);
      ["up", "down", "left", "right"].forEach((key) => {
        run.pads[team][key] = Boolean(data[key]);
      });
      run.pads[team].seen = Date.now();
      runs[code] = run;
      write(RUNS, runs);
      return reply({ ok: true });
    }
    return reply({ ok: false }, 404);
  };
})();
