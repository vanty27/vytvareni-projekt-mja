
const ADMIN_EMAIL = "v.antonyuk95@gmail.com";
const $ = (id) => document.getElementById(id);

let authMode = "login";
let session = null;
let profile = null;
let projects = [];
let current = null;
let active = null;
let drag = null;
let dragOffset = { x: 0, y: 0 };
let zoom = 1;

const screens = ["login", "pending", "projects", "project", "admin"].map($);

function show(screenId) {
  screens.forEach((screen) => screen.classList.add("hidden"));
  $(screenId).classList.remove("hidden");
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateStr(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function fmt(value) {
  return value
    ? new Date(value).toLocaleString("cs-CZ", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}

function colorCss(color) {
  if (color === "green") return "var(--g)";
  if (color === "orange") return "var(--o)";
  if (color === "blue") return "#60a5fa";
  if (color === "gray") return "#94a3b8";
  return "var(--r)";
}

function approvalColor(approvals = {}) {
  const count = ["karel", "ivca", "vlada"].filter((name) => approvals[name]).length;
  if (count === 3) return "green";
  if (count >= 1) return "orange";
  return "red";
}

function ownerColor(owner) {
  if (owner === "karel") return "green";
  if (owner === "ivca") return "blue";
  if (owner === "vlada") return "orange";
  if (owner === "roman") return "gray";
  return "red";
}

/* Auth */
$("tabLogin").onclick = () => setMode("login");
$("tabRegister").onclick = () => setMode("register");

function setMode(mode) {
  authMode = mode;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabRegister").classList.toggle("active", mode === "register");
  $("authBtn").textContent = mode === "login" ? "Přihlásit" : "Registrovat";
  $("authHint").textContent = mode === "login" ? "Přihlášení" : "Registrace";
  $("msg").textContent = "";
}

$("authBtn").onclick = async () => {
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;

  if (!email || !password) {
    $("msg").textContent = "Vyplň email a heslo.";
    return;
  }

  $("authBtn").disabled = true;

  try {
    if (authMode === "login") {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await init();
    } else {
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      $("msg").textContent = "Registrace uložena. Účet čeká na schválení adminem.";
      setMode("login");
    }
  } catch (error) {
    $("msg").textContent = error.message || "Chyba";
  } finally {
    $("authBtn").disabled = false;
  }
};

async function init() {
  const { data } = await supabaseClient.auth.getSession();
  session = data.session;

  if (!session) {
    show("login");
    return;
  }

  const { data: loadedProfile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();

  const email = (session.user.email || "").toLowerCase();

  if (email === ADMIN_EMAIL) {
    profile =
      loadedProfile || {
        id: session.user.id,
        email: session.user.email,
        role: "admin",
        status: "approved",
      };
  } else {
    if (error || !loadedProfile || loadedProfile.status !== "approved") {
      show("pending");
      return;
    }
    profile = loadedProfile;
  }

  $("adminBtn").classList.toggle("hidden", profile.role !== "admin");

  await loadProjects();
  renderProjects();
  show("projects");
}

async function logout() {
  await supabaseClient.auth.signOut();
  session = null;
  profile = null;
  projects = [];
  current = null;
  show("login");
}

$("logout").onclick = logout;
$("logoutPending").onclick = logout;

/* Projects */
async function loadProjects() {
  const { data, error } = await supabaseClient.from("projects").select("*").order("updated_at", { ascending: false });
  if (error) {
    console.warn(error);
    toast("Nepodařilo se načíst projekty");
    projects = [];
    return;
  }

  projects = data || [];
  for (const project of projects) await refreshProjectImages(project);
}

function projectMeta(project) {
  const data = project.data || {};
  if (project.type === "timeline") {
    const rows = data.rows?.length || 0;
    const items = (data.rows || []).reduce((sum, row) => sum + (row.items || []).length, 0);
    return `${rows} řádků · ${items} položek<br>Klikni pro otevření projektu`;
  }
  if (project.type === "notesCalendar") {
    return `${data.notes?.length || 0} poznámek<br>Klikni pro otevření projektu`;
  }
  return `${data.nodes?.length || 0} karet · ${data.edges?.length || 0} propojení<br>Klikni pro otevření projektu`;
}

function renderProjects() {
  ["listImageMap", "listPavojk", "listTimeline", "listCalendar"].forEach((id) => ($(id).innerHTML = ""));

  const target = {
    imageMap: "listImageMap",
    pavojk: "listPavojk",
    timeline: "listTimeline",
    notesCalendar: "listCalendar",
  };

  projects.forEach((project) => {
    const button = document.createElement("button");
    button.className = "projectCard";
    button.innerHTML = `<h3>${esc(project.name)}</h3><p>${projectMeta(project)}</p>`;
    button.onclick = () => openProject(project.id);
    $(target[project.type] || "listImageMap").appendChild(button);
  });
}

function defaultData(type) {
  if (type === "timeline") {
    const today = new Date();
    return {
      start: dateStr(today),
      days: Math.ceil((new Date(today.getFullYear(), 11, 31) - today) / 86400000) + 1,
      rows: [1, 2, 3].map(() => ({ id: uid(), name: "Nový řádek", items: [] })),
    };
  }

  if (type === "notesCalendar") {
    const today = new Date();
    return {
      year: today.getFullYear(),
      month: today.getMonth(),
      notes: [],
      dayDetails: {},
    };
  }

  return {
    nodes: [
      {
        id: uid(),
        title: type === "pavojk" ? "Nová buňka" : "Homepage",
        x: 1000,
        y: 520,
        short: "",
        detail: "",
        detailImages: [],
        notes: [],
        approvals: { karel: false, ivca: false, vlada: false },
        titleColor: type === "pavojk" ? "orange" : "red",
        imagePath: null,
        imageUrl: null,
      },
    ],
    edges: [],
  };
}

async function createProject(type, name) {
  const { data, error } = await supabaseClient
    .from("projects")
    .insert({ name, type, data: defaultData(type) })
    .select()
    .single();

  if (error) {
    console.warn(error);
    toast("Projekt se nepodařilo vytvořit");
    return;
  }

  projects.unshift(data);
  $("typeModal").classList.add("hidden");
  openProject(data.id);
}

async function openProject(id) {
  current = projects.find((project) => project.id === id);

  if (!current) {
    toast("Projekt nenalezen");
    return;
  }

  await refreshProjectImages(current);
  $("projectName").textContent = current.name;
  show("project");
  renderWork();
}

async function save() {
  if (!current) return;

  current.updated_at = new Date().toISOString();

  const { error } = await supabaseClient
    .from("projects")
    .update({
      name: current.name,
      data: current.data,
      updated_at: current.updated_at,
    })
    .eq("id", current.id);

  if (error) {
    console.warn(error);
    toast("Uložení selhalo");
  }
}

$("newProject").onclick = () => {
  $("projectTitleInput").value = "";
  $("typeModal").classList.remove("hidden");
};

$("closeType").onclick = () => $("typeModal").classList.add("hidden");

document.querySelectorAll("#typeModal [data-type]").forEach((button) => {
  button.onclick = () => {
    const name = $("projectTitleInput").value.trim() || "Projekt " + (projects.length + 1);
    createProject(button.dataset.type, name);
  };
});

$("back").onclick = async () => {
  await loadProjects();
  renderProjects();
  current = null;
  show("projects");
};

$("deleteProject").onclick = async () => {
  if (!current || !confirm("Opravdu smazat projekt?")) return;

  const { error } = await supabaseClient.from("projects").delete().eq("id", current.id);
  if (error) {
    console.warn(error);
    toast("Projekt se nepodařilo smazat");
    return;
  }

  projects = projects.filter((project) => project.id !== current.id);
  current = null;
  renderProjects();
  show("projects");
};

$("printPdf").onclick = () => window.print();

$("addMain").onclick = async () => {
  if (!current) return;

  if (current.type === "timeline") {
    current.data.rows = current.data.rows || [];
    current.data.rows.push({ id: uid(), name: "Nový řádek", items: [] });
    await save();
    renderWork();
    return;
  }

  if (current.type === "notesCalendar") {
    toast("V kalendáři přidáš poznámku přes plus v konkrétním dni.");
    return;
  }

  const data = ensureMapData();
  data.nodes.push({
    id: uid(),
    title: current.type === "pavojk" ? "Nová buňka" : "Nová stránka",
    x: 1000 + data.nodes.length * 80,
    y: 520 + data.nodes.length * 60,
    short: "",
    detail: "",
    detailImages: [],
    notes: [],
    approvals: { karel: false, ivca: false, vlada: false },
    titleColor: current.type === "pavojk" ? "orange" : "red",
    imagePath: null,
    imageUrl: null,
  });

  await save();
  renderWork();
};

/* Workspace and zoom */
function ensureZoomControls() {
  if ($("zoomBox")) return;

  const box = document.createElement("span");
  box.id = "zoomBox";
  box.className = "zoomBox";
  box.innerHTML = `<button id="zoomOut">−</button><span id="zoomValue">100%</span><button id="zoomIn">+</button>`;
  $("printPdf").parentElement.insertBefore(box, $("printPdf"));

  $("zoomOut").onclick = () => setZoom(Math.max(0.35, zoom - 0.1));
  $("zoomIn").onclick = () => setZoom(Math.min(2, zoom + 0.1));
}

function setZoom(value) {
  zoom = Math.round(value * 100) / 100;
  $("canvas").style.transform = `scale(${zoom})`;
  $("svg").style.transform = `scale(${zoom})`;
  $("svg").style.transformOrigin = "0 0";
  if ($("zoomValue")) $("zoomValue").textContent = Math.round(zoom * 100) + "%";
}

function renderWork() {
  $("canvas").innerHTML = "";
  $("svg").innerHTML = "";
  document.querySelectorAll(".timelineWrap,.calendarWrap").forEach((element) => element.remove());

  if (current.type === "timeline") {
    if ($("zoomBox")) $("zoomBox").classList.add("hidden");
    setZoom(1);
    renderTimeline();
    return;
  }

  if (current.type === "notesCalendar") {
    if ($("zoomBox")) $("zoomBox").classList.add("hidden");
    setZoom(1);
    renderCalendar();
    return;
  }

  ensureZoomControls();
  $("zoomBox").classList.remove("hidden");
  renderMap();
  setZoom(zoom);
}

/* Map and Pavojk */
function ensureMapData() {
  current.data = current.data || {};
  current.data.nodes = current.data.nodes || [];
  current.data.edges = current.data.edges || [];
  return current.data;
}

function renderMap() {
  const data = ensureMapData();

  data.nodes.forEach((node) => {
    const card = document.createElement("div");
    card.className = "node" + (current.type === "pavojk" ? " pavojk" : "");
    card.style.left = node.x + "px";
    card.style.top = node.y + "px";

    const headerColor = current.type === "imageMap" ? approvalColor(node.approvals) : node.titleColor || "orange";

    card.innerHTML = `
      <div class="head" style="background:${colorCss(headerColor)}">
        <h3 contenteditable>${esc(node.title || "Nová buňka")}</h3>
        ${
          current.type === "imageMap"
            ? `<button class="round apprBtn" title="Schválení">👍</button>`
            : `<button class="round colorBtn" title="Barva buňky">🎨</button>`
        }
        <button class="round noteBtn ${node.notes?.length ? "has" : ""}" data-count="${node.notes?.length || 0}" title="Poznámky">💡</button>
        <button class="round del">×</button>
      </div>
      ${
        current.type === "imageMap"
          ? `<div class="imgArea">${
              node.imageUrl
                ? `<img src="${node.imageUrl}">`
                : `<span>Zatím není nahraný obrázek<br>Klikni na „Nahrát“</span>`
            }</div>`
          : ""
      }
      <div class="body">
        <input class="short" placeholder="Detail / krátký popis" value="${esc(node.short || "")}">
        <div class="actions">
          ${
            current.type === "imageMap"
              ? `<label class="file">Nahrát<input class="nodeFile" type="file" accept="image/*" hidden></label><button class="openDetail">Detail obrázku</button>`
              : `<button class="openDetail">Detail</button>`
          }
        </div>
      </div>
      <button class="addChild">+</button>
    `;

    $("canvas").appendChild(card);
    attachNodeEvents(card, node);
  });

  renderEdges();
}

function attachNodeEvents(card, node) {
  card.querySelector("[contenteditable]").oninput = async (event) => {
    node.title = event.target.textContent.trim();
    await save();
  };

  card.querySelector(".short").oninput = async (event) => {
    node.short = event.target.value;
    await save();
  };

  card.querySelector(".del").onclick = async (event) => {
    event.stopPropagation();
    if (!confirm("Opravdu smazat kartu?")) return;

    const data = ensureMapData();
    data.nodes = data.nodes.filter((item) => item.id !== node.id);
    data.edges = data.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
    current.data = data;

    await save();
    renderWork();
  };

  card.querySelector(".addChild").onclick = async (event) => {
    event.stopPropagation();

    const data = ensureMapData();
    const child = {
      id: uid(),
      title: current.type === "pavojk" ? "Nová buňka" : "Nová stránka",
      x: node.x + 440,
      y: node.y + 90,
      short: "",
      detail: "",
      detailImages: [],
      notes: [],
      approvals: { karel: false, ivca: false, vlada: false },
      titleColor: current.type === "pavojk" ? "orange" : "red",
      imagePath: null,
      imageUrl: null,
    };

    data.nodes.push(child);
    data.edges.push({ id: uid(), from: node.id, to: child.id });

    await save();
    renderWork();
  };

  card.querySelector(".openDetail").onclick = (event) => {
    event.stopPropagation();
    openDetail({ type: "node", nodeId: node.id });
  };

  const fileInput = card.querySelector(".nodeFile");
  if (fileInput) {
    fileInput.onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const uploaded = await upload(file, `projects/${current.id}/nodes/${node.id}`);
      if (!uploaded) return;

      node.imagePath = uploaded.path;
      node.imageUrl = uploaded.url;

      await save();

      const imgArea = card.querySelector(".imgArea");
      imgArea.innerHTML = `<img src="${node.imageUrl}">`;
      fileInput.value = "";
    };
  }

  const apprBtn = card.querySelector(".apprBtn");
  if (apprBtn) {
    apprBtn.onclick = (event) => {
      event.stopPropagation();
      toggleApproval(card, node);
    };
  }

  const colorBtn = card.querySelector(".colorBtn");
  if (colorBtn) {
    colorBtn.onclick = (event) => {
      event.stopPropagation();
      toggleColor(card, node);
    };
  }

  card.querySelector(".noteBtn").onclick = (event) => {
    event.stopPropagation();
    openNotes(card, node);
  };

  card.onpointerdown = (event) => {
    if (event.target.closest("button,input,label,textarea,[contenteditable],.notes,.approvalPop,.colorPop")) return;
    drag = { card, node };
    dragOffset.x = event.clientX / zoom - node.x;
    dragOffset.y = event.clientY / zoom - node.y;
    card.setPointerCapture(event.pointerId);
  };

  card.onpointermove = (event) => {
    if (!drag || drag.node.id !== node.id) return;

    node.x = event.clientX / zoom - dragOffset.x;
    node.y = event.clientY / zoom - dragOffset.y;

    card.style.left = node.x + "px";
    card.style.top = node.y + "px";
    renderEdges();
  };

  card.onpointerup = async () => {
    if (!drag) return;
    drag = null;
    await save();
  };
}

function renderEdges() {
  const data = ensureMapData();
  $("svg").innerHTML = "";

  data.edges.forEach((edge) => {
    const from = data.nodes.find((node) => node.id === edge.from);
    const to = data.nodes.find((node) => node.id === edge.to);
    if (!from || !to) return;

    const x1 = from.x + 320;
    const y1 = from.y + 110;
    const x2 = to.x;
    const y2 = to.y + 110;
    const mid = (x1 + x2) / 2;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#95a3b8");
    path.setAttribute("stroke-width", "3");
    $("svg").appendChild(path);
  });
}

function toggleApproval(card, node) {
  card.querySelector(".approvalPop")?.remove();

  const pop = document.createElement("div");
  pop.className = "approvalPop";
  pop.innerHTML = ["karel", "ivca", "vlada"]
    .map((person) => {
      const label = person === "karel" ? "Karel" : person === "ivca" ? "Ivča" : "Vláďa";
      return `<div><b>${label}</b><button class="${node.approvals?.[person] ? "on" : ""}" data-p="${person}">👍</button></div>`;
    })
    .join("");

  card.appendChild(pop);

  pop.querySelectorAll("button").forEach((button) => {
    button.onclick = async (event) => {
      event.stopPropagation();
      node.approvals = node.approvals || { karel: false, ivca: false, vlada: false };
      node.approvals[button.dataset.p] = !node.approvals[button.dataset.p];
      await save();
      renderWork();
    };
  });
}

function toggleColor(card, node) {
  card.querySelector(".colorPop")?.remove();

  const pop = document.createElement("div");
  pop.className = "colorPop";
  const colors = [
    ["green", "Zelená"],
    ["orange", "Oranžová"],
    ["red", "Červená"],
    ["blue", "Modrá"],
    ["gray", "Šedivá"],
  ];

  pop.innerHTML = colors
    .map(
      ([value, label]) =>
        `<button class="${node.titleColor === value ? "active" : ""}" data-color="${value}" title="${label}" style="background:${colorCss(value)}"></button>`
    )
    .join("");

  card.appendChild(pop);

  pop.querySelectorAll("button").forEach((button) => {
    button.onclick = async (event) => {
      event.stopPropagation();
      node.titleColor = button.dataset.color;
      await save();
      renderWork();
    };
  });
}

function openNotes(card, node) {
  document.querySelectorAll(".notes").forEach((panel) => panel.remove());
  document.querySelectorAll(".node").forEach((item) => item.classList.remove("front"));

  card.classList.add("front");

  const panel = document.createElement("div");
  panel.className = "notes";
  panel.innerHTML = `
    <div class="notesHead"><span>💡 Poznámky</span><button>×</button></div>
    <div class="notesList"></div>
    <div class="notesForm">
      <input class="ne" value="${esc(session.user.email)}">
      <textarea class="nt" placeholder="Napiš poznámku..."></textarea>
      <button class="primary send">Odeslat poznámku</button>
    </div>
  `;

  card.appendChild(panel);
  renderNotes(panel, node);

  panel.querySelector(".notesHead button").onclick = () => {
    panel.remove();
    card.classList.remove("front");
  };

  panel.querySelector(".send").onclick = async () => {
    const email = panel.querySelector(".ne").value.trim();
    const text = panel.querySelector(".nt").value.trim();

    if (!email || !text) {
      toast("Vyplň email i poznámku");
      return;
    }

    node.notes = node.notes || [];
    node.notes.push({
      id: uid(),
      email,
      text,
      createdAt: new Date().toISOString(),
    });

    panel.querySelector(".nt").value = "";
    await save();
    renderNotes(panel, node);

    const noteBtn = card.querySelector(".noteBtn");
    noteBtn.classList.add("has");
    noteBtn.dataset.count = node.notes.length;
  };
}

function renderNotes(panel, node) {
  const list = panel.querySelector(".notesList");

  if (!node.notes?.length) {
    list.innerHTML = `<p class="muted" style="text-align:center;margin-top:40px">Zatím žádné poznámky.</p>`;
    return;
  }

  list.innerHTML = node.notes
    .map(
      (note) => `
      <div class="nitem">
        <div class="avatar">${esc((note.email || "?")[0].toUpperCase())}</div>
        <div class="bubble"><b>${esc(note.email)} · ${fmt(note.createdAt)}</b><br>${esc(note.text)}</div>
      </div>
    `
    )
    .join("");
}

/* Detail */
function target() {
  if (!current || !active) return null;

  const data = current.data || {};

  if (active.type === "node") {
    return data.nodes?.find((node) => node.id === active.nodeId);
  }

  if (active.type === "calendarNote") {
    return data.notes?.find((note) => note.id === active.noteId);
  }

  if (active.type === "calendarDay") {
    data.dayDetails = data.dayDetails || {};
    if (!data.dayDetails[active.date]) {
      data.dayDetails[active.date] = { title: "Detail dne " + active.date, detail: "", detailImages: [] };
    }
    return data.dayDetails[active.date];
  }

  return null;
}

function openDetail(nextActive) {
  active = nextActive;

  const item = target();
  if (!item) return;

  $("detailTitle").textContent = "Detail – " + (item.title || item.name || "Nová buňka");

  let titleInput = $("detailTitleInput");
  if (!titleInput) {
    titleInput = document.createElement("input");
    titleInput.id = "detailTitleInput";
    titleInput.placeholder = "Název";
    $("detailTitle").after(titleInput);
  }

  titleInput.value = item.title || item.name || "";
  $("detailText").value = item.detail || "";
  renderDetailImages(item);
  $("detailModal").classList.remove("hidden");
}

function renderDetailImages(item) {
  const images = item.detailImages || [];
  const mainPreview = item.imageUrl ? `<div class="mainPreview"><img src="${item.imageUrl}"></div>` : "";

  if (!images.length) {
    $("detailImgs").innerHTML =
      mainPreview +
      `<p class="muted" style="text-align:center;padding:24px;border:1px dashed var(--bd);border-radius:16px">Zatím nejsou přidané žádné obrázky.</p>`;
  } else {
    $("detailImgs").innerHTML =
      mainPreview +
      images
        .map(
          (image, index) =>
            `<div class="dimg"><img src="${image.url}"><button data-index="${index}" title="Smazat obrázek">×</button></div>`
        )
        .join("");
  }

  $("detailImgs").querySelectorAll("img").forEach((image) => {
    image.onclick = () => {
      $("bigImg").src = image.src;
      $("imgModal").classList.remove("hidden");
    };
  });

  $("detailImgs")
    .querySelectorAll(".dimg button")
    .forEach((button) => {
      button.onclick = async () => {
        item.detailImages.splice(Number(button.dataset.index), 1);
        await save();
        renderDetailImages(item);
      };
    });
}

$("detailFile").onchange = async (event) => {
  const item = target();
  const files = [...(event.target.files || [])];

  if (!item || !files.length) return;

  item.detailImages = item.detailImages || [];

  for (const file of files) {
    const uploaded = await upload(file, `projects/${current.id}/details`);
    if (uploaded) {
      item.detailImages.push(uploaded);
      renderDetailImages(item);
    }
  }

  await save();
  event.target.value = "";
};

$("saveDetail").onclick = async () => {
  const item = target();
  if (!item) return;

  item.detail = $("detailText").value;

  const titleInput = $("detailTitleInput");
  if (titleInput && titleInput.value.trim()) {
    if ("title" in item || active.type === "calendarNote" || active.type === "node") {
      item.title = titleInput.value.trim();
    } else {
      item.name = titleInput.value.trim();
    }
  }

  await save();
  $("detailModal").classList.add("hidden");
  renderWork();
};

$("deleteDetail").onclick = async () => {
  if (!active || !confirm("Opravdu smazat?")) return;

  const data = current.data || {};

  if (active.type === "node") {
    data.nodes = data.nodes.filter((node) => node.id !== active.nodeId);
    data.edges = data.edges.filter((edge) => edge.from !== active.nodeId && edge.to !== active.nodeId);
  }

  if (active.type === "calendarNote") {
    data.notes = data.notes.filter((note) => note.id !== active.noteId);
  }

  if (active.type === "calendarDay") {
    delete data.dayDetails[active.date];
  }

  await save();
  $("detailModal").classList.add("hidden");
  renderWork();
};

$("closeDetail").onclick = () => $("detailModal").classList.add("hidden");
$("closeImg").onclick = () => {
  $("imgModal").classList.add("hidden");
  $("bigImg").src = "";
};

/* Uploads */
async function upload(file, folder) {
  const ext = file.name.split(".").pop() || "png";
  const path = `${folder}/${uid()}.${ext}`;

  const { error } = await supabaseClient.storage.from("images").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });

  if (error) {
    console.warn(error);
    toast("Nahrání obrázku selhalo");
    return null;
  }

  const { data } = await supabaseClient.storage.from("images").createSignedUrl(path, 60 * 60 * 24 * 7);

  return { path, url: data?.signedUrl || "" };
}

async function signedUrl(path) {
  if (!path) return "";
  const { data } = await supabaseClient.storage.from("images").createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl || "";
}

async function refreshProjectImages(project) {
  const data = project.data || {};

  for (const node of data.nodes || []) {
    if (node.imagePath) node.imageUrl = await signedUrl(node.imagePath);
    for (const image of node.detailImages || []) {
      if (image.path) image.url = await signedUrl(image.path);
    }
  }

  for (const row of data.rows || []) {
    for (const item of row.items || []) {
      for (const image of item.detailImages || []) {
        if (image.path) image.url = await signedUrl(image.path);
      }
    }
  }

  for (const note of data.notes || []) {
    for (const image of note.detailImages || []) {
      if (image.path) image.url = await signedUrl(image.path);
    }
  }

  for (const day of Object.values(data.dayDetails || {})) {
    for (const image of day.detailImages || []) {
      if (image.path) image.url = await signedUrl(image.path);
    }
  }
}

/* Timeline */
function renderTimeline() {
  const data = current.data || {};
  data.rows = data.rows || [];

  const wrapper = document.createElement("div");
  wrapper.className = "timelineWrap";

  const days = [...Array(data.days || 198)].map((_, index) => {
    const date = new Date(data.start);
    date.setDate(date.getDate() + index);
    return date;
  });

  wrapper.innerHTML = `
    <table class="tl">
      <thead>
        <tr>
          <th>Časová osa</th>
          ${days
            .map((day) => `<th>${day.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit" })}</th>`)
            .join("")}
        </tr>
      </thead>
      <tbody>
        ${data.rows
          .map(
            (row) => `
          <tr data-row="${row.id}">
            <td>
              <div class="tlTitle">
                <button class="danger delRow">×</button>
                <span contenteditable>${esc(row.name)}</span>
                <button class="editRow">✎</button>
              </div>
            </td>
            ${days.map((day) => `<td data-date="${dateStr(day)}"></td>`).join("")}
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
    <button class="addRow" style="margin:16px">+ Přidat řádek</button>
  `;

  $("work").appendChild(wrapper);

  data.rows.forEach((row) => {
    row.items = row.items || [];

    row.items.forEach((item) => {
      const rowElement = wrapper.querySelector(`tr[data-row="${row.id}"]`);
      const startIndex = days.findIndex((day) => dateStr(day) === item.start);
      const endIndex = days.findIndex((day) => dateStr(day) === item.end);

      if (startIndex < 0 || !rowElement) return;

      const cell = rowElement.children[startIndex + 1];
      const div = document.createElement("div");
      div.className = `tlItem tl${item.color || "red"}`;
      div.style.width = `${Math.max(1, (endIndex >= startIndex ? endIndex - startIndex + 1 : 1)) * 38 - 6}px`;
      div.textContent = item.title || row.name;
      div.onclick = () => openTimelineEditor(row, item);
      cell.appendChild(div);
    });
  });

  wrapper.querySelector(".addRow").onclick = async () => {
    data.rows.push({ id: uid(), name: "Nový řádek", items: [] });
    current.data = data;
    await save();
    renderWork();
  };

  wrapper.querySelectorAll("tr[data-row]").forEach((rowElement) => {
    const row = data.rows.find((item) => item.id === rowElement.dataset.row);

    rowElement.querySelector("[contenteditable]").oninput = async (event) => {
      row.name = event.target.textContent.trim();
      await save();
    };

    rowElement.querySelector(".delRow").onclick = async () => {
      data.rows = data.rows.filter((item) => item.id !== row.id);
      current.data = data;
      await save();
      renderWork();
    };

    rowElement.querySelector(".editRow").onclick = async () => {
      const item = {
        id: uid(),
        title: row.name || "Položka",
        start: data.start,
        end: data.start,
        owner: "",
        color: "red",
        detail: "",
        detailImages: [],
      };

      row.items.push(item);
      await save();
      renderWork();
      openTimelineEditor(row, item);
    };
  });
}

function openTimelineEditor(row, item) {
  let modal = $("timelineEditor");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "timelineEditor";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="box timelineBox">
        <button id="closeTimelineEditor" class="x">×</button>
        <h2>Upravit položku</h2>
        <div class="timelineForm">
          <label>Název položky / buňky</label>
          <input id="timelineTitle" type="text">

          <div class="timelineFormGrid">
            <div>
              <label>Od kdy</label>
              <input id="timelineStart" type="date">
            </div>
            <div>
              <label>Do kdy</label>
              <input id="timelineEnd" type="date">
            </div>
          </div>

          <label>Vybrat vlastníka</label>
          <select id="timelineOwner">
            <option value="">Nevybráno - Červená</option>
            <option value="karel">Karel - Zelená</option>
            <option value="ivca">Ivča - Modrá</option>
            <option value="vlada">Vláďa - Oranžová</option>
            <option value="roman">Roman - Šedivá</option>
          </select>
        </div>
        <div class="footer">
          <button id="deleteTimelineItem" class="danger">Smazat položku</button>
          <button id="saveTimelineItem" class="primary">Uložit</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  $("timelineTitle").value = item.title || row.name || "Položka";
  $("timelineStart").value = item.start || current.data.start;
  $("timelineEnd").value = item.end || item.start || current.data.start;
  $("timelineOwner").value = item.owner || "";

  modal.classList.remove("hidden");

  $("closeTimelineEditor").onclick = () => modal.classList.add("hidden");

  $("saveTimelineItem").onclick = async () => {
    item.title = $("timelineTitle").value.trim() || "Položka";
    item.start = $("timelineStart").value;
    item.end = $("timelineEnd").value || item.start;
    item.owner = $("timelineOwner").value;
    item.color = ownerColor(item.owner);

    await save();
    modal.classList.add("hidden");
    renderWork();
  };

  $("deleteTimelineItem").onclick = async () => {
    row.items = (row.items || []).filter((entry) => entry.id !== item.id);
    await save();
    modal.classList.add("hidden");
    renderWork();
  };
}

/* Calendar */
function renderCalendar() {
  const data = current.data || {};
  data.notes = data.notes || [];
  data.dayDetails = data.dayDetails || {};

  const today = new Date();

  if (typeof data.year !== "number") data.year = today.getFullYear();
  if (typeof data.month !== "number") data.month = today.getMonth();

  const wrapper = document.createElement("div");
  wrapper.className = "calendarWrap";

  const monthName = new Date(data.year, data.month, 1).toLocaleDateString("cs-CZ", {
    month: "long",
    year: "numeric",
  });

  const days = calendarDays(data.year, data.month);

  wrapper.innerHTML = `
    <div class="calTop">
      <button class="prevMonth">‹</button>
      <button class="nextMonth">›</button>
      <h2>${esc(monthName)}</h2>
      <button class="todayMonth">Dnes</button>
    </div>
    <div class="calGrid">
      ${["Po", "Út", "St", "Čt", "Pá", "So", "Ne"].map((day) => `<div class="wd">${day}</div>`).join("")}
      ${days
        .map((day) => {
          const value = dateStr(day);
          const notes = data.notes.filter((note) => note.date === value);

          return `
            <div class="day ${day.getMonth() !== data.month ? "other" : ""}" data-date="${value}">
              <div class="dayHead"><b>${day.getDate()}</b><button class="addNote">+</button></div>
              ${notes.map((note) => `<div class="cnote" data-note="${note.id}">${esc(note.title || "Nová poznámka")}</div>`).join("")}
            </div>
          `;
        })
        .join("")}
    </div>
  `;

  $("work").appendChild(wrapper);

  wrapper.querySelector(".prevMonth").onclick = async () => {
    data.month -= 1;
    if (data.month < 0) {
      data.month = 11;
      data.year -= 1;
    }
    await save();
    renderWork();
  };

  wrapper.querySelector(".nextMonth").onclick = async () => {
    data.month += 1;
    if (data.month > 11) {
      data.month = 0;
      data.year += 1;
    }
    await save();
    renderWork();
  };

  wrapper.querySelector(".todayMonth").onclick = async () => {
    data.year = today.getFullYear();
    data.month = today.getMonth();
    await save();
    renderWork();
  };

  wrapper.querySelectorAll(".day").forEach((dayElement) => {
    const date = dayElement.dataset.date;

    dayElement.ondblclick = (event) => {
      if (event.target.closest("button,.cnote")) return;
      openDetail({ type: "calendarDay", date });
    };

    dayElement.querySelector(".addNote").onclick = async (event) => {
      event.stopPropagation();

      const note = {
        id: uid(),
        date,
        title: "Nová poznámka",
        detail: "",
        detailImages: [],
      };

      data.notes.push(note);
      await save();
      renderWork();
      openDetail({ type: "calendarNote", noteId: note.id });
    };
  });

  wrapper.querySelectorAll(".cnote").forEach((noteElement) => {
    noteElement.ondblclick = (event) => {
      event.stopPropagation();
      openDetail({ type: "calendarNote", noteId: noteElement.dataset.note });
    };
  });
}

function calendarDays(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);

  return [...Array(42)].map((_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

/* Admin */
$("adminBtn").onclick = async () => {
  await loadRequests();
  show("admin");
};

$("backAdmin").onclick = () => show("projects");

async function loadRequests() {
  const { data, error } = await supabaseClient.from("profiles").select("*").order("created_at", { ascending: false });

  if (error) {
    console.warn(error);
    $("requests").innerHTML = "<p>Nepodařilo se načíst žádosti.</p>";
    return;
  }

  const pending = (data || []).filter((item) => item.status === "pending");

  if (!pending.length) {
    $("requests").innerHTML = '<p class="muted">Žádné čekající žádosti.</p>';
    return;
  }

  $("requests").innerHTML = pending
    .map(
      (item) => `
      <div class="req">
        <div><b>${esc(item.email)}</b><p class="muted">Čeká na schválení · ${fmt(item.created_at)}</p></div>
        <div><button class="primary ok" data-id="${item.id}">Schválit</button><button class="danger no" data-id="${item.id}">Zamítnout</button></div>
      </div>
    `
    )
    .join("");

  $("requests").querySelectorAll(".ok").forEach((button) => {
    button.onclick = () => updateUser(button.dataset.id, "approved");
  });

  $("requests").querySelectorAll(".no").forEach((button) => {
    button.onclick = () => updateUser(button.dataset.id, "rejected");
  });
}

async function updateUser(id, status) {
  const patch = { status };
  if (status === "approved") patch.approved_at = new Date().toISOString();

  const { error } = await supabaseClient.from("profiles").update(patch).eq("id", id);

  if (error) {
    console.warn(error);
    toast("Změna stavu selhala");
    return;
  }

  await loadRequests();
}

supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
  session = nextSession;
});

init();
