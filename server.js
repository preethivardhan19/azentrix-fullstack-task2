const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret-before-production";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "store.json");
const DATA_DIR = path.dirname(DATA_FILE);
const PUBLIC_DIR = path.join(__dirname, "public");

const columns = ["todo", "progress", "done"];
const columnTitles = {
  todo: "To Do",
  progress: "In Progress",
  done: "Done",
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, saved) {
  const [salt, hash] = saved.split(":");
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), candidate);
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function makeCookie(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, createdAt: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readCookie(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((part) => part.length === 2),
  );
}

function currentUser(req) {
  const cookie = readCookie(req.headers.cookie || "").task_session;
  if (!cookie) return null;

  const [payload, signature] = cookie.split(".");
  if (!payload || signature !== sign(payload)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return store.users.find((user) => user.id === data.userId && user.active !== false) || null;
  } catch {
    return null;
  }
}

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) return;

  const adminId = createId("user");
  const memberId = createId("user");
  const boardId = createId("board");

  const starterStore = {
    users: [
      {
        id: adminId,
        name: "Asha Admin",
        email: "admin@example.com",
        password: hashPassword("Admin@123"),
        role: "admin",
        active: true,
      },
      {
        id: memberId,
        name: "Rahul Member",
        email: "member@example.com",
        password: hashPassword("Member@123"),
        role: "member",
        active: true,
      },
    ],
    boards: [
      {
        id: boardId,
        name: "Website Launch",
        createdAt: new Date().toISOString(),
      },
    ],
    cards: [
      {
        id: createId("card"),
        boardId,
        column: "todo",
        title: "Prepare landing page copy",
        description: "Write short copy for the hero section and feature blocks.",
        assigneeId: memberId,
        dueDate: "2026-07-05",
        priority: "medium",
        position: 1,
        createdBy: adminId,
        updatedAt: new Date().toISOString(),
      },
      {
        id: createId("card"),
        boardId,
        column: "progress",
        title: "Connect contact form",
        description: "Save form submissions and show a success message.",
        assigneeId: adminId,
        dueDate: "2026-07-08",
        priority: "high",
        position: 1,
        createdBy: adminId,
        updatedAt: new Date().toISOString(),
      },
      {
        id: createId("card"),
        boardId,
        column: "done",
        title: "Create brand palette",
        description: "Finalize colors and reusable button styles.",
        assigneeId: memberId,
        dueDate: "2026-07-02",
        priority: "low",
        position: 1,
        createdBy: memberId,
        updatedAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(starterStore, null, 2));
}

function loadStore() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

let store = loadStore();

function saveStore() {
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active !== false,
  };
}

function boardPayload(user) {
  return {
    currentUser: publicUser(user),
    users: store.users.map(publicUser),
    boards: store.boards,
    cards: store.cards,
    columns,
    columnTitles,
    updatedAt: store.updatedAt,
  };
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Please login first." });
    return null;
  }
  return user;
}

function canManageCard(user, card) {
  return user.role === "admin" || card.assigneeId === user.id || card.createdBy === user.id;
}

function normalizePositions(boardId, column) {
  store.cards
    .filter((card) => card.boardId === boardId && card.column === column)
    .sort((a, b) => a.position - b.position)
    .forEach((card, index) => {
      card.position = index + 1;
    });
}

function moveCard(card, nextColumn, nextPosition) {
  const oldColumn = card.column;
  card.column = columns.includes(nextColumn) ? nextColumn : card.column;
  normalizePositions(card.boardId, oldColumn);
  normalizePositions(card.boardId, card.column);

  const targetCards = store.cards
    .filter((item) => item.boardId === card.boardId && item.column === card.column && item.id !== card.id)
    .sort((a, b) => a.position - b.position);

  const safePosition = Math.max(1, Math.min(Number(nextPosition) || targetCards.length + 1, targetCards.length + 1));
  targetCards.splice(safePosition - 1, 0, card);
  targetCards.forEach((item, index) => {
    item.position = index + 1;
  });
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/register" && req.method === "POST") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");

    if (!name || !email || password.length < 6) {
      return sendJson(res, 400, { error: "Name, email, and a 6 character password are required." });
    }

    if (store.users.some((user) => user.email === email)) {
      return sendJson(res, 409, { error: "Email already exists." });
    }

    const user = {
      id: createId("user"),
      name,
      email,
      password: hashPassword(password),
      role: "member",
      active: true,
    };

    store.users.push(user);
    saveStore();

    return sendJson(res, 201, { user: publicUser(user) }, {
      "Set-Cookie": `task_session=${makeCookie(user.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`,
    });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const user = store.users.find((item) => item.email === email && item.active !== false);

    if (!user || !verifyPassword(String(body.password || ""), user.password)) {
      return sendJson(res, 401, { error: "Invalid email or password." });
    }

    return sendJson(res, 200, { user: publicUser(user) }, {
      "Set-Cookie": `task_session=${makeCookie(user.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`,
    });
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": "task_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (pathname === "/api/me" && req.method === "GET") {
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (pathname === "/api/board" && req.method === "GET") {
    return sendJson(res, 200, boardPayload(user));
  }

  if (pathname === "/api/cards" && req.method === "POST") {
    const body = await parseBody(req);
    const board = store.boards[0];
    const card = {
      id: createId("card"),
      boardId: board.id,
      column: columns.includes(body.column) ? body.column : "todo",
      title: String(body.title || "").trim(),
      description: String(body.description || "").trim(),
      assigneeId: String(body.assigneeId || user.id),
      dueDate: String(body.dueDate || ""),
      priority: ["low", "medium", "high"].includes(body.priority) ? body.priority : "medium",
      position: store.cards.filter((item) => item.boardId === board.id && item.column === (body.column || "todo")).length + 1,
      createdBy: user.id,
      updatedAt: new Date().toISOString(),
    };

    if (!card.title) return sendJson(res, 400, { error: "Card title is required." });
    if (user.role !== "admin") card.assigneeId = user.id;

    store.cards.push(card);
    saveStore();
    return sendJson(res, 201, { card, updatedAt: store.updatedAt });
  }

  const cardMatch = pathname.match(/^\/api\/cards\/([^/]+)$/);
  const moveMatch = pathname.match(/^\/api\/cards\/([^/]+)\/move$/);

  if (cardMatch && req.method === "PUT") {
    const card = store.cards.find((item) => item.id === cardMatch[1]);
    if (!card) return sendJson(res, 404, { error: "Card not found." });
    if (!canManageCard(user, card)) return sendJson(res, 403, { error: "You can only manage your own cards." });

    const body = await parseBody(req);
    card.title = String(body.title || card.title).trim();
    card.description = String(body.description || "").trim();
    card.dueDate = String(body.dueDate || "");
    card.priority = ["low", "medium", "high"].includes(body.priority) ? body.priority : card.priority;
    if (user.role === "admin" && body.assigneeId) card.assigneeId = String(body.assigneeId);
    card.updatedAt = new Date().toISOString();
    saveStore();
    return sendJson(res, 200, { card, updatedAt: store.updatedAt });
  }

  if (cardMatch && req.method === "DELETE") {
    const card = store.cards.find((item) => item.id === cardMatch[1]);
    if (!card) return sendJson(res, 404, { error: "Card not found." });
    if (!canManageCard(user, card)) return sendJson(res, 403, { error: "You can only manage your own cards." });

    store.cards = store.cards.filter((item) => item.id !== card.id);
    normalizePositions(card.boardId, card.column);
    saveStore();
    return sendJson(res, 200, { ok: true, updatedAt: store.updatedAt });
  }

  if (moveMatch && req.method === "PATCH") {
    const card = store.cards.find((item) => item.id === moveMatch[1]);
    if (!card) return sendJson(res, 404, { error: "Card not found." });
    if (!canManageCard(user, card)) return sendJson(res, 403, { error: "You can only move your own cards." });

    const body = await parseBody(req);
    moveCard(card, body.column, body.position);
    card.updatedAt = new Date().toISOString();
    saveStore();
    return sendJson(res, 200, { card, updatedAt: store.updatedAt });
  }

  if (pathname === "/api/users" && req.method === "PATCH") {
    if (user.role !== "admin") return sendJson(res, 403, { error: "Admin access required." });

    const body = await parseBody(req);
    const target = store.users.find((item) => item.id === body.userId);
    if (!target) return sendJson(res, 404, { error: "User not found." });
    if (target.id === user.id && body.active === false) return sendJson(res, 400, { error: "You cannot disable yourself." });

    if (["admin", "member"].includes(body.role)) target.role = body.role;
    if (typeof body.active === "boolean") target.active = body.active;
    saveStore();
    return sendJson(res, 200, { user: publicUser(target), updatedAt: store.updatedAt });
  }

  return sendJson(res, 404, { error: "API route not found." });
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`TaskFlow server running at http://localhost:${PORT}`);
});
