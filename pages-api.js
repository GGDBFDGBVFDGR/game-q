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

  function roomId() {
    const raw = new URLSearchParams(location.search).get("room") || "main";
    return raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "main";
  }

  function encodeRem(n) {
    const out = [];
    do {
      let digit = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) digit |= 128;
      out.push(digit);
    } while (n > 0);
    return out;
  }

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  function pack(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    parts.forEach((part) => {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function mqttString(text) {
    const body = utf8(text);
    return pack([new Uint8Array([(body.length >> 8) & 255, body.length & 255]), body]);
  }

  function mqttPacket(type, body) {
    return pack([new Uint8Array([type, ...encodeRem(body.length)]), body]);
  }

  const relayRuns = {};
  let socket = null;
  let relayReady = false;
  const relayWaiters = [];
  const subscriptions = new Set();

  function relayKey(code) {
    return `${code}/${roomId()}`;
  }

  function relayRun(code) {
    const key = relayKey(code);
    if (!relayRuns[key]) relayRuns[key] = blankRun();
    connectRelay();
    subscribeRelay(key);
    return relayRuns[key];
  }

  function connectRelay() {
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    socket = new WebSocket("wss://broker.hivemq.com:8884/mqtt", ["mqtt"]);
    socket.binaryType = "arraybuffer";
    relayReady = false;
    socket.onopen = () => {
      const flags = new Uint8Array([0, 4, 77, 81, 84, 84, 4, 2, 0, 30]);
      const id = mqttString(`q${Math.random().toString(16).slice(2, 12)}`);
      socket.send(mqttPacket(0x10, pack([flags, id])));
    };
    socket.onmessage = (event) => {
      const bytes = new Uint8Array(event.data);
      if (bytes[0] === 0x20) {
        relayReady = bytes[3] === 0;
        subscriptions.clear();
        Object.keys(relayRuns).forEach(subscribeRelay);
        relayWaiters.splice(0).forEach((done) => done());
        return;
      }
      if ((bytes[0] >> 4) !== 3) return;
      const head = readRem(bytes, 1);
      if (!head) return;
      const topicLen = (bytes[head.next] << 8) | bytes[head.next + 1];
      const topicStart = head.next + 2;
      const topic = new TextDecoder().decode(bytes.slice(topicStart, topicStart + topicLen));
      const payload = new TextDecoder().decode(bytes.slice(topicStart + topicLen, head.next + head.value));
      applyRelay(topic, payload);
    };
    socket.onclose = () => {
      relayReady = false;
      socket = null;
      window.setTimeout(connectRelay, 1500);
    };
  }

  function readRem(bytes, start) {
    let value = 0;
    let mul = 1;
    let index = start;
    let encoded = 0;
    do {
      if (index >= bytes.length) return null;
      encoded = bytes[index];
      index += 1;
      value += (encoded & 127) * mul;
      mul *= 128;
    } while (encoded & 128);
    return { value, next: index };
  }

  function subscribeRelay(key) {
    const filter = `qgame/${key}/#`;
    if (subscriptions.has(filter) || !relayReady || !socket) return;
    subscriptions.add(filter);
    const id = 1;
    socket.send(mqttPacket(0x82, pack([new Uint8Array([(id >> 8) & 255, id & 255]), mqttString(filter), new Uint8Array([0])])));
  }

  function publishRelay(code, tail, value, retain) {
    const topic = `qgame/${relayKey(code)}/${tail}`;
    const body = pack([mqttString(topic), utf8(JSON.stringify(value))]);
    const packet = mqttPacket(retain ? 0x31 : 0x30, body);
    const send = () => {
      if (socket && relayReady) socket.send(packet);
    };
    if (socket && relayReady) send();
    else {
      connectRelay();
      relayWaiters.push(send);
    }
  }

  function applyRelay(topic, payload) {
    const parts = topic.split("/");
    if (parts[0] !== "qgame" || parts.length < 4) return;
    const key = `${parts[1]}/${parts[2]}`;
    const run = relayRuns[key] || blankRun();
    relayRuns[key] = run;
    const kind = parts[3];
    let data = {};
    try {
      data = JSON.parse(payload);
    } catch (error) {
      return;
    }
    if (kind === "reset") {
      if (run.mark && data.at && data.at < run.mark) return;
      const fresh = blankRun();
      run.pads = fresh.pads;
      run.question = fresh.question;
      run.answers = [];
      run.shops = [];
      return;
    }
    if (kind === "question" && data && typeof data === "object") {
      run.mark = Date.now();
      run.question = data;
      return;
    }
    if (kind === "pad") {
      const team = parts[4];
      if (!run.pads[team]) return;
      ["up", "down", "left", "right"].forEach((dir) => {
        run.pads[team][dir] = Boolean(data[dir]);
      });
      run.pads[team].seen = Date.now();
      return;
    }
    if (kind === "answer" && data && !run.answers.some((item) => item.id === data.id)) {
      run.answers.push(data);
      run.answers = run.answers.slice(-20);
      return;
    }
    if (kind === "shop" && data && !run.shops.some((item) => item.id === data.id)) {
      run.shops.push(data);
      run.shops = run.shops.slice(-20);
    }
  }

  let relayStamp = 0;
  function relayId() {
    relayStamp = Math.max(relayStamp + 1, Date.now());
    return relayStamp;
  }

  window.setInterval(() => {
    if (socket && relayReady) socket.send(new Uint8Array([0xc0, 0]));
  }, 20000);

  function reply(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function bank(name) {
    try {
      const value = (0, eval)(`typeof ${name} === "undefined" ? null : ${name}`);
      return Array.isArray(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function seed() {
    const games = read(GAMES);
    let changed = false;
    const starter = bank("ROOMS");
    const security = bank("SECURITY");
    const labs = bank("LABS");
    if (!games.QSTART && starter) {
      const rooms = normalize(starter);
      if (rooms) {
        games.QSTART = { rooms };
        changed = true;
      }
    }
    if (!games.RQHJQ5 && security) {
      const rooms = normalize(security);
      if (rooms) {
        games.RQHJQ5 = { rooms };
        changed = true;
      }
    }
    if (!games.LABQAZ && labs) {
      const rooms = normalize(labs);
      if (rooms) {
        games.LABQAZ = { rooms };
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
      const run = relayRun(queryCode);
      return reply({
        origin: siteOrigin(),
        pads: { 1: padView(run.pads[1]), 2: padView(run.pads[2]) },
        answers: run.answers,
        shops: run.shops,
      });
    }
    if (method === "GET" && path === "/api/question") {
      if (!queryCode) return reply({ ok: false, error: "Нет такого кода" }, 404);
      const run = relayRun(queryCode);
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
    if (!code) return reply({ ok: false, error: "Нет такого кода" }, 404);
    if ((path === "/api/reset" || path === "/api/question") && !games[code]) {
      return reply({ ok: false, error: "Нет такого кода" }, 404);
    }
    const run = relayRun(code);
    if (method === "POST" && path === "/api/reset") {
      const fresh = blankRun();
      run.pads = fresh.pads;
      run.question = fresh.question;
      run.answers = [];
      run.shops = [];
      publishRelay(code, "reset", { at: Date.now() }, false);
      return reply({ ok: true });
    }
    if (method === "POST" && path === "/api/question") {
      const teams = data.teams && typeof data.teams === "object" ? data.teams : { 1: data, 2: data };
      const next = { 1: run.question[1], 2: run.question[2] };
      ["1", "2"].forEach((key) => {
        const item = teams[key];
        if (!item || typeof item !== "object") return;
        next[key] = {
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
      run.question = next;
      run.mark = Date.now();
      publishRelay(code, "question", next, true);
      return reply({ ok: true });
    }
    if (method === "POST" && path === "/api/answer") {
      const team = String(data.team || "");
      if (!run.pads[team] || typeof data.quiz !== "number" || typeof data.index !== "number") return reply({ ok: false }, 400);
      const item = { id: relayId(), team, quiz: data.quiz, index: data.index };
      run.answers.push(item);
      run.answers = run.answers.slice(-20);
      publishRelay(code, "answer", item, false);
      return reply({ ok: true });
    }
    if (method === "POST" && path === "/api/shop") {
      const team = String(data.team || "");
      if (!run.pads[team] || (data.action !== "cut" && data.action !== "reveal")) return reply({ ok: false }, 400);
      const item = { id: relayId(), team, action: data.action };
      run.shops.push(item);
      run.shops = run.shops.slice(-20);
      publishRelay(code, "shop", item, false);
      return reply({ ok: true });
    }
    if (method === "POST" && path === "/api/pad") {
      const team = String(data.team || "");
      if (!run.pads[team]) return reply({ ok: false }, 400);
      const pad = { up: false, down: false, left: false, right: false };
      ["up", "down", "left", "right"].forEach((key) => {
        pad[key] = Boolean(data[key]);
        run.pads[team][key] = pad[key];
      });
      run.pads[team].seen = Date.now();
      publishRelay(code, `pad/${team}`, pad, true);
      return reply({ ok: true });
    }
    return reply({ ok: false }, 404);
  };
})();
