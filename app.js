// === Atlantis NAS v3.2 — Nested folders, better UX, persistence, batch actions ===
// - Firebase modular SDK 11.0.1 (ES modules)
// - Adds nested folders (parentId), breadcrumbs, selection/bulk actions,
//   offline persistence, better listener handling, retry/display of index/rules errors.
// - Drops in for existing index.html + styles.css without markup edits.

// --- Firebase imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  enableIndexedDbPersistence,
  getDoc,
  getDocs,
  limit,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// --- Firebase config (pakai config project-mu) ---
const firebaseConfig = {
  apiKey: "AIzaSyBdKELW2FNsL7H1zB8R765czcDPaSYybdg",
  authDomain: "atlantis-store.firebaseapp.com",
  databaseURL: "https://atlantis-store-default-rtdb.firebaseio.com",
  projectId: "atlantis-store",
  storageBucket: "atlantis-store.appspot.com",
  messagingSenderId: "566295949160",
  appId: "1:566295949160:web:2edd2bd1c4b74277a5f0dd",
  measurementId: "G-ERXQQKY7HM",
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Enable offline persistence (best-effort; will log if not available)
enableIndexedDbPersistence(db).catch((err) => {
  console.warn("Firestore persistence not enabled:", err && err.code ? err.code : err);
});

// --- App state ---
let currentUser = null;
let currentFolder = null; // id of currently opened folder (null => root)
let folderUnsub = null;
let fileUnsub = null;
let breadcrumbs = []; // array of {id, name}

// --- DOM refs (some dynamic elements created if needed) ---
const loginSection = document.getElementById("login-section");
const appSection = document.getElementById("app-section");
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("login-email");
const passInput = document.getElementById("login-password");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const folderForm = document.getElementById("folder-form");
const folderInput = document.getElementById("folder-name");
const folderList = document.getElementById("folder-list");
const fileList = document.getElementById("file-list");
const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");
const dropArea = document.getElementById("drop-area");
const toast = document.getElementById("toast");
const folderTitle = document.getElementById("folder-title");
const globalSearch = document.getElementById("global-search");

// dynamic controls area (buttons for bulk actions)
let bulkControls = null;

// --- UTILS ---
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.style.opacity = "0";
  toast.style.display = "block";
  requestAnimationFrame(() => (toast.style.opacity = "1"));
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => (toast.style.display = "none"), 250);
  }, 2200);
}
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
}
function el(tag, cls = "", attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}
function safeLog(...a) { try { console.log(...a); } catch (e) {} }

// --- Robust onSnapshot wrapper with label + retry suggestion ---
function safeOnSnapshot(q, onData, label = "listener") {
  try {
    return onSnapshot(
      q,
      (snap) => onData(snap),
      (err) => {
        console.warn(`Firestore ${label} error:`, err);
        // detect likely errors and show helpful toast
        if (err && err.code === "failed-precondition") {
          showToast("⚠️ Firestore: index composite diperlukan. Cek console.");
        } else if (err && err.code === "permission-denied") {
          showToast("🚫 Akses ke Firestore ditolak. Periksa rules.");
        } else {
          showToast("❌ Koneksi realtime Firestore terganggu.");
        }
      }
    );
  } catch (e) {
    console.error("safeOnSnapshot setup failed:", e);
  }
}

// --- AUTH FLOW ---
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = emailInput.value.trim();
  const password = passInput.value.trim();
  if (!email.endsWith("@atlantis.com")) {
    loginError.textContent = "Harap gunakan email @atlantis.com";
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = "Login gagal: " + (err.message || err.code);
  }
});

logoutBtn.addEventListener("click", () => {
  signOut(auth).catch((e) => console.warn("Signout failed:", e));
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    document.getElementById("user-info").textContent = user.email;
    loginSection.style.display = "none";
    appSection.removeAttribute("aria-hidden");
    // reset to root view
    breadcrumbs = [{ id: null, name: "Root" }];
    currentFolder = null;
    renderBreadcrumbs();
    setTimeout(loadFoldersRealtime, 150);
    // attach other listeners if needed
  } else {
    currentUser = null;
    // clean up listeners
    if (folderUnsub) folderUnsub();
    if (fileUnsub) fileUnsub();
    appSection.setAttribute("aria-hidden", "true");
    loginSection.style.display = "flex";
  }
});

// --- NESTED FOLDERS ---
// folder document structure:
// { name, createdBy, parentId (nullable), createdAt, fileCount }

// Render breadcrumbs
function renderBreadcrumbs() {
  // ensure container exists in top of right-col
  let bc = document.getElementById("breadcrumb");
  if (!bc) {
    bc = el("div", "breadcrumbs");
    bc.id = "breadcrumb";
    // insert above files-header: find files-header
    const filesHeader = document.querySelector(".files-header");
    if (filesHeader && filesHeader.parentNode) {
      filesHeader.parentNode.insertBefore(bc, filesHeader);
    } else {
      // fallback: prepend to right-col
      const right = document.querySelector(".right-col");
      if (right) right.prepend(bc);
    }
  }
  bc.innerHTML = "";
  breadcrumbs.forEach((b, idx) => {
    const crumb = el("button", "btn crumb");
    crumb.textContent = idx === 0 ? b.name : " / " + b.name;
    crumb.onclick = () => {
      // navigate to that breadcrumb
      // trim breadcrumbs
      breadcrumbs = breadcrumbs.slice(0, idx + 1);
      const target = b.id || null;
      openFolder(target, b.name);
    };
    bc.appendChild(crumb);
  });
}

// Load folders (only immediate children of currentFolder) realtime
function loadFoldersRealtime() {
  if (!currentUser) return;
  // query: where createdBy == currentUser.email && parentId == currentFolder
  const q = query(
    collection(db, "folders"),
    where("createdBy", "==", currentUser.email),
    where("parentId", "==", currentFolder || null),
    orderBy("createdAt", "desc")
  );
  if (folderUnsub) folderUnsub();
  folderUnsub = safeOnSnapshot(
    q,
    (snap) => {
      folderList.innerHTML = "";
      // header: "New Folder inside {name}"
      snap.forEach((docu) => {
        const f = docu.data();
        const div = el("div", "folder-card");
        div.dataset.id = docu.id;
        // nested indentation not needed because we show only children
        div.innerHTML = `
          <span>📁 ${f.name}</span>
          <small class="small-muted">${f.fileCount || 0} file</small>
        `;
        // Open folder (push breadcrumb)
        div.onclick = (e) => {
          e.stopPropagation();
          breadcrumbs.push({ id: docu.id, name: f.name });
          renderBreadcrumbs();
          openFolder(docu.id, f.name);
        };
        // Drag target
        div.ondragover = (e) => {
          e.preventDefault();
          div.classList.add("drag-over");
        };
        div.ondragleave = () => div.classList.remove("drag-over");
        div.ondrop = (e) => handleMoveFiles(e, docu.id);
        // right-click context maybe (rename / delete) - simple prompt
        div.oncontextmenu = (e) => {
          e.preventDefault();
          const choice = prompt("Rename folder (kosong = batalkan):", f.name);
          if (choice && choice.trim() !== f.name) {
            updateDoc(doc(db, "folders", docu.id), { name: choice.trim() });
            showToast("✏️ Nama folder diperbarui");
          }
        };
        folderList.appendChild(div);
      });
      // also show '..' (go up) if not root
      // We'll handle go-up via breadcrumb so not adding here.
    },
    "folders"
  );
}

// Create folder (supports parent)
folderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = folderInput.value.trim();
  if (!name || !currentUser) return;
  try {
    await addDoc(collection(db, "folders"), {
      name,
      createdBy: currentUser.email,
      parentId: currentFolder || null,
      createdAt: serverTimestamp(),
      fileCount: 0,
    });
    folderInput.value = "";
    showToast("📁 Folder dibuat");
  } catch (err) {
    console.error("Create folder failed:", err);
    showToast("Gagal membuat folder");
  }
});

// Open folder (set currentFolder, load its files and children)
async function openFolder(id, name) {
  currentFolder = id || null;
  folderTitle.textContent = "📂 " + (name || "Root");
  renderBreadcrumbs();
  // load child folders again (this.keep real-time listener)
  loadFoldersRealtime();
  // load files in this folder
  loadFilesRealtime();
}

// --- FILES (realtime per folder) ---
function loadFilesRealtime() {
  if (!currentUser) return;
  // Query files where folderId == currentFolder and owner == currentUser.email
  const q = query(
    collection(db, "files"),
    where("folderId", "==", currentFolder || null),
    where("owner", "==", currentUser.email),
    orderBy("createdAt", "desc")
  );
  if (fileUnsub) fileUnsub();
  fileUnsub = safeOnSnapshot(
    q,
    (snap) => {
      fileList.innerHTML = "";
      // Create header controls for selection
      ensureBulkControls();
      snap.forEach((docu) => {
        const f = docu.data();
        const li = el("li", "file-row");
        li.dataset.id = docu.id;
        li.draggable = true;
        // File meta
        const created = f.createdAt?.seconds
          ? new Date(f.createdAt.seconds * 1000).toLocaleString()
          : "baru";
        li.innerHTML = `
          <div class="file-info">
            <input type="checkbox" class="file-checkbox" data-id="${docu.id}" />
            <div class="file-meta" style="margin-left:8px;">
              <span class="file-name">${f.name}</span>
              <span class="file-sub">${formatBytes(f.size)} • ${created}</span>
            </div>
          </div>
          <div class="file-actions">
            <button class="btn" data-preview="${f.url}">👁️</button>
            <button class="btn danger" data-delete="${docu.id}" data-path="${f.storagePath}">🗑️</button>
          </div>
        `;
        // drag start
        li.ondragstart = (e) => {
          e.dataTransfer.setData("text/plain", docu.id);
        };
        fileList.appendChild(li);
      });
      // attach handlers for preview/delete buttons and checkboxes
      attachFileRowHandlers();
    },
    "files"
  );
}

// --- File row handlers (delegated) ---
function attachFileRowHandlers() {
  // preview
  fileList.querySelectorAll("button[data-preview]").forEach((btn) => {
    btn.onclick = (e) => {
      const url = btn.getAttribute("data-preview");
      if (url) previewFile(url);
    };
  });
  // delete
  fileList.querySelectorAll("button[data-delete]").forEach((btn) => {
    btn.onclick = async (e) => {
      const id = btn.getAttribute("data-delete");
      const path = btn.getAttribute("data-path");
      if (!id || !path) return;
      if (!confirm("Hapus file ini?")) return;
      try {
        await deleteDoc(doc(db, "files", id));
        await deleteObject(ref(storage, path)).catch((e) => {
          // maybe file already missing — still okay
          console.warn("Delete object error:", e);
        });
        showToast("🗑️ File dihapus");
      } catch (err) {
        console.error("Delete failed:", err);
        showToast("Gagal menghapus file");
      }
    };
  });
  // checkboxes: nothing more (bulkControls handles them)
  fileList.querySelectorAll(".file-checkbox").forEach((cb) => {
    cb.onchange = updateBulkSelectionUI;
  });
}

// --- BULK ACTIONS UI / helpers ---
function ensureBulkControls() {
  if (bulkControls) return;
  bulkControls = el("div", "bulk-controls");
  bulkControls.id = "bulk-controls";
  bulkControls.innerHTML = `
    <button id="bulk-download" class="btn">⬇️ Download selected</button>
    <button id="bulk-delete" class="btn danger">🗑️ Delete selected</button>
    <button id="clear-selection" class="btn">✖ Clear</button>
  `;
  document.body.appendChild(bulkControls);
  // handlers
  bulkControls.querySelector("#clear-selection").onclick = () => {
    fileList.querySelectorAll(".file-checkbox").forEach((cb) => (cb.checked = false));
    updateBulkSelectionUI();
  };
  bulkControls.querySelector("#bulk-delete").onclick = bulkDeleteSelected;
  bulkControls.querySelector("#bulk-download").onclick = bulkDownloadSelected;
  updateBulkSelectionUI();
}

function updateBulkSelectionUI() {
  const selected = Array.from(fileList.querySelectorAll(".file-checkbox:checked"));
  if (!bulkControls) return;
  bulkControls.style.display = selected.length > 0 ? "block" : "none";
  // maybe show count — quick visual
  const dl = bulkControls.querySelector("#bulk-download");
  dl.textContent = `⬇️ Download (${selected.length})`;
  const del = bulkControls.querySelector("#bulk-delete");
  del.textContent = `🗑️ Delete (${selected.length})`;
}

async function bulkDeleteSelected() {
  const selected = Array.from(fileList.querySelectorAll(".file-checkbox:checked")).map((c) => c.dataset.id);
  if (selected.length === 0) return showToast("Pilih file dulu");
  if (!confirm(`Hapus ${selected.length} file?`)) return;
  for (const id of selected) {
    try {
      // fetch doc to get storagePath
      const fd = await getDoc(doc(db, "files", id));
      const data = fd.exists() ? fd.data() : null;
      if (data?.storagePath) {
        await deleteObject(ref(storage, data.storagePath)).catch((e) => console.warn("Storage delete:", e));
      }
      await deleteDoc(doc(db, "files", id));
    } catch (err) {
      console.error("Bulk delete error:", err);
      showToast("Ada kesalahan saat menghapus beberapa file");
    }
  }
  showToast("🗑️ Bulk delete selesai");
}

async function bulkDownloadSelected() {
  // Browser-side zip or parallel download is possible but heavy.
  // We'll open each file in new tab to let user save (simple).
  const selected = Array.from(fileList.querySelectorAll(".file-checkbox:checked")).map((c) => c.dataset.id);
  if (selected.length === 0) return showToast("Pilih file dulu");
  showToast("Membuka file di tab baru untuk download...");
  for (const id of selected) {
    try {
      const fd = await getDoc(doc(db, "files", id));
      const data = fd.exists() ? fd.data() : null;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err) {
      console.warn("Open file failed:", err);
    }
  }
}

// --- Upload (with global progress indicator) ---
let globalProgressEl = null;
function ensureGlobalProgress() {
  if (globalProgressEl) return;
  globalProgressEl = el("div", "global-progress");
  globalProgressEl.style.position = "fixed";
  globalProgressEl.style.left = "20px";
  globalProgressEl.style.bottom = "140px";
  globalProgressEl.style.background = "rgba(0,0,0,0.6)";
  globalProgressEl.style.color = "#fff";
  globalProgressEl.style.padding = "8px 12px";
  globalProgressEl.style.borderRadius = "10px";
  globalProgressEl.style.display = "none";
  document.body.appendChild(globalProgressEl);
}
function showGlobalProgress(msg) {
  ensureGlobalProgress();
  globalProgressEl.textContent = msg;
  globalProgressEl.style.display = "block";
}
function hideGlobalProgress() {
  if (!globalProgressEl) return;
  globalProgressEl.style.display = "none";
}

uploadBtn.onclick = () => fileInput.click();
fileInput.onchange = (e) => handleFilesUpload(e.target.files);

dropArea.ondragover = (e) => {
  e.preventDefault();
  dropArea.classList.add("dragover");
};
dropArea.ondragleave = () => dropArea.classList.remove("dragover");
dropArea.ondrop = (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
  handleFilesUpload(e.dataTransfer.files);
};

function handleFilesUpload(files) {
  if (!currentFolder && currentFolder !== null) {
    // should not happen, but guard
    showToast("Pilih folder dulu!");
    return;
  }
  if (!currentUser) return showToast("Harap login dulu");
  const arr = [...files];
  if (arr.length === 0) return;
  showGlobalProgress(`Uploading ${arr.length} file(s)...`);
  let completed = 0;
  arr.forEach((file) => {
    const path = `${currentUser.uid}/${currentFolder || "root"}/${file.name}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    task.on(
      "state_changed",
      (snap) => {
        const percent = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        showGlobalProgress(`⬆️ ${file.name} — ${percent}%`);
      },
      (err) => {
        console.error("Upload failed:", err);
        showToast("Upload gagal: " + (err.message || err.code));
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          await addDoc(collection(db, "files"), {
            name: file.name,
            size: file.size,
            folderId: currentFolder || null,
            owner: currentUser.email,
            storagePath: path,
            url,
            createdAt: serverTimestamp(),
          });
          // Optionally update folder's fileCount (increment)
          if (currentFolder) {
            const folderDocRef = doc(db, "folders", currentFolder);
            // naive increment: read -> update (race possible)
            // for production, use transactions (omitted for clarity)
            try {
              const fdoc = await getDoc(folderDocRef);
              if (fdoc.exists()) {
                const prev = fdoc.data().fileCount || 0;
                await updateDoc(folderDocRef, { fileCount: prev + 1 });
              }
            } catch (e) {
              console.warn("folder fileCount update failed:", e);
            }
          }
          completed++;
          if (completed === arr.length) {
            showToast("✅ Semua upload selesai");
            hideGlobalProgress();
          }
        } catch (err) {
          console.error("Finalize upload failed:", err);
          showToast("Gagal menyelesaikan upload");
          hideGlobalProgress();
        }
      }
    );
  });
}

// --- Drag/drop files to move between folders ---
async function handleMoveFiles(e, targetFolderId) {
  e.preventDefault();
  const fileId = e.dataTransfer.getData("text/plain");
  if (!fileId) return;
  try {
    await updateDoc(doc(db, "files", fileId), { folderId: targetFolderId });
    showToast("📦 File dipindahkan");
  } catch (err) {
    console.error("Move failed:", err);
    showToast("Gagal memindahkan file");
  }
}

// --- Preview modal (simple) ---
window.previewFile = (url) => {
  const modal = document.getElementById("preview-modal");
  const body = document.getElementById("preview-body");
  const download = document.getElementById("preview-download");
  body.innerHTML = `<iframe src="${url}" width="100%" height="600" style="border:0;border-radius:8px;"></iframe>`;
  download.href = url;
  modal.setAttribute("aria-hidden", "false");
};
document.getElementById("close-preview").onclick = () =>
  document.getElementById("preview-modal").setAttribute("aria-hidden", "true");

// --- Search (debounced) ---
let searchTimer = null;
globalSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const term = globalSearch.value.trim().toLowerCase();
    if (!term) {
      // show all
      Array.from(fileList.children).forEach((li) => (li.style.display = ""));
      return;
    }
    Array.from(fileList.children).forEach((li) => {
      const name = (li.querySelector(".file-name")?.textContent || "").toLowerCase();
      li.style.display = name.includes(term) ? "" : "none";
    });
  }, 220);
});

// --- Keyboard shortcut: Ctrl/Cmd+K focus search ---
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    globalSearch.focus();
  }
});

// --- Theme toggle (kept) ---
const themeBtn = document.getElementById("toggle-theme");
themeBtn.onclick = () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
};
document.documentElement.dataset.theme =
  localStorage.getItem("theme") ||
  (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

// --- Initial bootstrap: render root breadcrumb and UI polish setup ---
(function init() {
  breadcrumbs = [{ id: null, name: "Root" }];
  renderBreadcrumbs();
  // small polish: show 'Drag files here' hint
  dropArea.innerHTML = `<p>Tarik & lepas file di sini, atau klik Upload</p><small class="muted">Folder saat ini: Root</small>`;
  showToast("Atlantis NAS siap (v3.2)");
})();

safeLog("Atlantis NAS v3.2 loaded");
