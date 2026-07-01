const authScreen = document.querySelector("#authScreen");
const app = document.querySelector("#app");
const loginForm = document.querySelector("#loginForm");
const registerForm = document.querySelector("#registerForm");
const authMessage = document.querySelector("#authMessage");
const tabButtons = document.querySelectorAll("[data-auth-tab]");
const logoutButton = document.querySelector("#logoutButton");
const boardElement = document.querySelector("#board");
const boardName = document.querySelector("#boardName");
const userName = document.querySelector("#userName");
const userRole = document.querySelector("#userRole");
const syncStatus = document.querySelector("#syncStatus");
const newCardButton = document.querySelector("#newCardButton");
const adminPanel = document.querySelector("#adminPanel");
const userList = document.querySelector("#userList");
const cardDialog = document.querySelector("#cardDialog");
const cardForm = document.querySelector("#cardForm");
const closeDialog = document.querySelector("#closeDialog");
const cardMessage = document.querySelector("#cardMessage");
const dialogTitle = document.querySelector("#dialogTitle");
const deleteCardButton = document.querySelector("#deleteCardButton");

let state = null;
let draggedCardId = null;
let pollTimer = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function userById(id) {
  return state.users.find((user) => user.id === id) || { name: "Unassigned" };
}

function canManage(card) {
  return state.currentUser.role === "admin" || card.assigneeId === state.currentUser.id || card.createdBy === state.currentUser.id;
}

function showAuth() {
  authScreen.classList.remove("hidden");
  app.classList.add("hidden");
  clearInterval(pollTimer);
}

function showApp() {
  authScreen.classList.add("hidden");
  app.classList.remove("hidden");
}

function renderBoard() {
  const board = state.boards[0];
  boardName.textContent = board.name;
  userName.textContent = state.currentUser.name;
  userRole.textContent = state.currentUser.role;

  boardElement.innerHTML = state.columns
    .map((column) => {
      const cards = state.cards
        .filter((card) => card.column === column)
        .sort((a, b) => a.position - b.position);

      return `
        <article class="column" data-column="${column}">
          <div class="column-header">
            <h2>${state.columnTitles[column]}</h2>
            <span class="count">${cards.length}</span>
          </div>
          <div class="card-list">
            ${cards.map(renderCard).join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCard(card) {
  const assignee = userById(card.assigneeId);
  const editable = canManage(card);

  return `
    <article class="task-card" draggable="${editable}" data-card-id="${card.id}">
      <div class="card-meta">
        <span class="pill priority-${card.priority}">${card.priority}</span>
        ${card.dueDate ? `<span class="pill">Due ${escapeHtml(card.dueDate)}</span>` : ""}
      </div>
      <h3>${escapeHtml(card.title)}</h3>
      <p>${escapeHtml(card.description || "No description added.")}</p>
      <div class="card-footer">
        <span class="pill">${escapeHtml(assignee.name)}</span>
        ${editable ? `<button class="edit-button" type="button" data-edit-card="${card.id}">Edit</button>` : ""}
      </div>
    </article>
  `;
}

function renderUsers() {
  adminPanel.classList.toggle("hidden", state.currentUser.role !== "admin");
  if (state.currentUser.role !== "admin") return;

  userList.innerHTML = state.users
    .map(
      (user) => `
        <div class="user-row" data-user-id="${user.id}">
          <div>
            <strong>${escapeHtml(user.name)}</strong>
            <small>${escapeHtml(user.email)}</small>
          </div>
          <select data-user-role="${user.id}">
            <option value="member" ${user.role === "member" ? "selected" : ""}>Member</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
          <select data-user-active="${user.id}" ${user.id === state.currentUser.id ? "disabled" : ""}>
            <option value="true" ${user.active ? "selected" : ""}>Active</option>
            <option value="false" ${!user.active ? "selected" : ""}>Disabled</option>
          </select>
        </div>
      `,
    )
    .join("");
}

function renderAssignees(selectedId = state.currentUser.id) {
  const assigneeSelect = document.querySelector("#cardAssignee");
  assigneeSelect.innerHTML = state.users
    .filter((user) => user.active)
    .map((user) => `<option value="${user.id}" ${user.id === selectedId ? "selected" : ""}>${escapeHtml(user.name)}</option>`)
    .join("");

  assigneeSelect.disabled = state.currentUser.role !== "admin";
}

function render() {
  renderBoard();
  renderUsers();
}

async function loadBoard(silent = false) {
  if (!silent) syncStatus.textContent = "Syncing...";
  state = await api("/api/board");
  showApp();
  render();
  syncStatus.textContent = "Synced";

  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const fresh = await api("/api/board");
      if (!state || fresh.updatedAt !== state.updatedAt) {
        state = fresh;
        render();
      }
      syncStatus.textContent = "Synced";
    } catch {
      syncStatus.textContent = "Offline";
    }
  }, 3000);
}

function openCardDialog(card = null, column = "todo") {
  cardMessage.textContent = "";
  cardForm.reset();
  document.querySelector("#cardId").value = card ? card.id : "";
  document.querySelector("#cardTitle").value = card ? card.title : "";
  document.querySelector("#cardDescription").value = card ? card.description : "";
  document.querySelector("#cardColumn").value = card ? card.column : column;
  document.querySelector("#cardPriority").value = card ? card.priority : "medium";
  document.querySelector("#cardDueDate").value = card ? card.dueDate : "";
  renderAssignees(card ? card.assigneeId : state.currentUser.id);
  dialogTitle.textContent = card ? "Edit Card" : "New Card";
  deleteCardButton.classList.toggle("hidden", !card);
  cardDialog.showModal();
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    const isLogin = button.dataset.authTab === "login";
    loginForm.classList.toggle("hidden", !isLogin);
    registerForm.classList.toggle("hidden", isLogin);
    authMessage.textContent = "";
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify(formData(loginForm)),
    });
    await loadBoard();
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "";
  try {
    await api("/api/register", {
      method: "POST",
      body: JSON.stringify(formData(registerForm)),
    });
    await loadBoard();
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showAuth();
});

newCardButton.addEventListener("click", () => openCardDialog());
closeDialog.addEventListener("click", () => cardDialog.close());

cardForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  cardMessage.textContent = "";

  const data = formData(cardForm);
  const id = data.id;

  try {
    if (id) {
      await api(`/api/cards/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    } else {
      await api("/api/cards", {
        method: "POST",
        body: JSON.stringify(data),
      });
    }

    cardDialog.close();
    await loadBoard(true);
  } catch (error) {
    cardMessage.textContent = error.message;
  }
});

deleteCardButton.addEventListener("click", async () => {
  const id = document.querySelector("#cardId").value;
  if (!id || !window.confirm("Delete this card?")) return;

  try {
    await api(`/api/cards/${id}`, { method: "DELETE" });
    cardDialog.close();
    await loadBoard(true);
  } catch (error) {
    cardMessage.textContent = error.message;
  }
});

boardElement.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-card]");
  if (!button) return;

  const card = state.cards.find((item) => item.id === button.dataset.editCard);
  if (card) openCardDialog(card);
});

boardElement.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".task-card");
  if (!card || card.getAttribute("draggable") !== "true") return;
  draggedCardId = card.dataset.cardId;
  card.classList.add("dragging");
});

boardElement.addEventListener("dragend", (event) => {
  const card = event.target.closest(".task-card");
  if (card) card.classList.remove("dragging");
  draggedCardId = null;
  document.querySelectorAll(".column").forEach((column) => column.classList.remove("drag-over"));
});

boardElement.addEventListener("dragover", (event) => {
  const column = event.target.closest(".column");
  if (!column || !draggedCardId) return;
  event.preventDefault();
  column.classList.add("drag-over");
});

boardElement.addEventListener("dragleave", (event) => {
  const column = event.target.closest(".column");
  if (column) column.classList.remove("drag-over");
});

boardElement.addEventListener("drop", async (event) => {
  const column = event.target.closest(".column");
  if (!column || !draggedCardId) return;

  event.preventDefault();
  const columnName = column.dataset.column;
  const cardCount = state.cards.filter((card) => card.column === columnName).length;

  try {
    await api(`/api/cards/${draggedCardId}/move`, {
      method: "PATCH",
      body: JSON.stringify({ column: columnName, position: cardCount + 1 }),
    });
    await loadBoard(true);
  } catch (error) {
    alert(error.message);
  }
});

userList.addEventListener("change", async (event) => {
  const roleSelect = event.target.closest("[data-user-role]");
  const activeSelect = event.target.closest("[data-user-active]");
  const userId = roleSelect ? roleSelect.dataset.userRole : activeSelect?.dataset.userActive;
  if (!userId) return;

  const role = document.querySelector(`[data-user-role="${userId}"]`).value;
  const active = document.querySelector(`[data-user-active="${userId}"]`).value === "true";

  try {
    await api("/api/users", {
      method: "PATCH",
      body: JSON.stringify({ userId, role, active }),
    });
    await loadBoard(true);
  } catch (error) {
    alert(error.message);
  }
});

api("/api/me")
  .then(() => loadBoard())
  .catch(() => showAuth());
