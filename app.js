// === Atlantis NAS v3.0 — app.js (Professional Edition) ===
// Full integration with new Data Grid UI & Glassmorphism Design.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  set,
  onValue,
  get,
  query,
  orderByChild,
  equalTo,
  update,
  remove,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// --- 1. CONFIGURATION (JANGAN DIUBAH) ---
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

// --- 2. STATE MANAGEMENT ---
let currentUser = null;
let currentUserRole = "staff";
let currentFolder = null; // null = Root
let folderListenerUnsub = null;
let fileListenerUnsub = null;
let breadcrumbs = [{ id: null, name: "Home" }];
let activeTab = "files"; // 'files', 'recycle', 'settings'
let foldersCache = {}; 

// --- 3. DOM ELEMENT REFERENCES ---
// Login Views
const loginSection = document.getElementById("login-section");
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("login-email");
const passInput = document.getElementById("login-password");
const loginError = document.getElementById("login-error");

// Main App Views
const appSection = document.getElementById("app-section");
const sidebar = document.querySelector(".sidebar");
const userEmailDisplay = document.getElementById("user-info");
const userAvatar = document.getElementById("user-avatar");
const logoutBtn = document.getElementById("logout-btn");

// Navigation
const tabFiles = document.getElementById("tab-files");
const tabRecycle = document.getElementById("tab-recycle");
const tabSettings = document.getElementById("tab-settings");

// Content Areas
const folderList = document.getElementById("folder-list");
const fileList = document.getElementById("file-list"); // The Table Body
const folderTitle = document.getElementById("folder-title");
const breadcrumbContainer = document.getElementById("breadcrumb");
const dropArea = document.getElementById("drop-area");

// Actions & Inputs
const folderForm = document.getElementById("folder-form");
const folderInput = document.getElementById("folder-name");
const uploadBtn = document.getElementById("upload-btn");
const fileInput = document.getElementById("file-input");
const globalSearch = document.getElementById("global-search");

// Bulk Actions
const bulkToolbar = document.getElementById("header-bulk-actions");
const btnBulkDownload = document.getElementById("bulk-download");
const btnBulkDelete = document.getElementById("bulk-delete");
const btnClearSelection = document.getElementById("clear-selection");

// Modals
const previewModal = document.getElementById("preview-modal");
const previewBody = document.getElementById("preview-body");
const previewDownload = document.getElementById("preview-download");
const settingsPanel = document.getElementById("settings-panel");
const settingsTheme = document.getElementById("settings-theme");
const settingsEmail = document.getElementById("settings-email");
const toast = document.getElementById("toast");

// Mobile Menu
const menuToggle = document.getElementById("menu-toggle");
const menuOverlay = document.getElementById("menu-overlay");

// --- 4. UTILITIES ---
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = "block";
  toast.style.animation = "slideUp 0.3s ease";
  // Auto hide after 3s
  setTimeout(() => {
    toast.style.display = "none";
  }, 3000);
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  if (!bytes) return "-";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + " " + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼️';
  if (['pdf'].includes(ext)) return '📕';
  if (['zip', 'rar', '7z', 'tar'].includes(ext)) return '📦';
  if (['mp4', 'mkv', 'mov'].includes(ext)) return '🎬';
  if (['mp3', 'wav'].includes(ext)) return '🎵';
  if (['doc', 'docx', 'txt'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  return '📄';
}

// Element Creator Helper
function el(tag, className, innerHTML = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (innerHTML) element.innerHTML = innerHTML;
  return element;
}

// --- 5. AUTHENTICATION LOGIC ---
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "Sedang masuk...";
  const email = emailInput.value.trim();
  const pass = passInput.value.trim();
  
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // Success handled by onAuthStateChanged
  } catch (err) {
    loginError.textContent = "Gagal Masuk: " + err.message;
  }
});

logoutBtn.addEventListener("click", () => {
  signOut(auth).then(() => showToast("Berhasil keluar"));
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    // User Logged In
    currentUser = user;
    
    // Update UI Info
    userEmailDisplay.textContent = user.email;
    settingsEmail.value = user.email;
    // Set Avatar Initial (e.g. "B" from bima)
    userAvatar.textContent = user.email.charAt(0).toUpperCase();

    // Check Role from DB
    const roleSnap = await get(ref(db, `users/${user.uid}/role`));
    currentUserRole = roleSnap.exists() ? roleSnap.val() : "staff";
    const badge = document.querySelector('.user-role-badge');
    if(badge) badge.textContent = currentUserRole.toUpperCase();

    // Switch View
    loginSection.style.display = "none";
    appSection.removeAttribute("aria-hidden");

    // Initialize App State
    currentFolder = null;
    breadcrumbs = [{ id: null, name: "Home" }];
    activeTab = "files";
    updateTabUI();
    
    showToast(`Selamat datang, ${user.email.split('@')[0]}`);
  } else {
    // User Logged Out
    currentUser = null;
    appSection.setAttribute("aria-hidden", "true");
    loginSection.style.display = "flex";
    if (folderListenerUnsub) folderListenerUnsub();
    if (fileListenerUnsub) fileListenerUnsub();
  }
});

// --- 6. NAVIGATION & TABS ---
function updateTabUI() {
  // Reset Tab Classes
  [tabFiles, tabRecycle, tabSettings].forEach(t => t.classList.remove('active'));
  
  // Hide all sections first
  document.querySelector('.section-folders').style.display = 'none';
  document.querySelector('.section-files').style.display = 'none';
  settingsPanel.setAttribute('aria-hidden', 'true');

  // Close Mobile Menu if open
  if(sidebar.classList.contains('open')) toggleMobileMenu();

  if (activeTab === 'files') {
    tabFiles.classList.add('active');
    document.querySelector('.section-folders').style.display = 'flex';
    document.querySelector('.section-files').style.display = 'flex';
    folderTitle.textContent = currentFolder ? foldersCache[currentFolder]?.name || 'Folder' : 'Home';
    loadFoldersRealtime();
    loadFilesRealtime();
  } else if (activeTab === 'recycle') {
    tabRecycle.classList.add('active');
    document.querySelector('.section-files').style.display = 'flex';
    folderTitle.textContent = "Recycle Bin";
    // Hide folders column in recycle bin mode to give more space
    document.querySelector('.section-folders').style.display = 'none';
    loadRecycleBin();
  } else if (activeTab === 'settings') {
    tabSettings.classList.add('active');
    settingsPanel.setAttribute('aria-hidden', 'false');
  }
}

tabFiles.onclick = () => { activeTab = "files"; updateTabUI(); };
tabRecycle.onclick = () => { activeTab = "recycle"; updateTabUI(); };
tabSettings.onclick = () => { activeTab = "settings"; updateTabUI(); };

document.getElementById('close-settings').onclick = () => {
  activeTab = "files";
  updateTabUI();
};

// --- 7. BREADCRUMBS ---
function renderBreadcrumbs() {
  breadcrumbContainer.innerHTML = "";
  breadcrumbs.forEach((crumb, index) => {
    // Create Breadcrumb Item
    const btn = el("button", "crumb", crumb.name);
    btn.onclick = () => {
      // Navigate to this crumb
      breadcrumbs = breadcrumbs.slice(0, index + 1);
      currentFolder = crumb.id;
      activeTab = "files"; // Force back to files tab
      updateTabUI();
    };
    breadcrumbContainer.appendChild(btn);

    // Add separator
    if (index < breadcrumbs.length - 1) {
      const sep = el("span", "", " / ");
      sep.style.color = "var(--text-muted)";
      sep.style.fontSize = "0.8rem";
      breadcrumbContainer.appendChild(sep);
    }
  });
}

// --- 8. REALTIME DATA: FOLDERS ---
function loadFoldersRealtime() {
  if (folderListenerUnsub) folderListenerUnsub();
  
  // Query folders where parentId matches currentFolder
  const q = query(ref(db, "folders"), orderByChild("parentId"), equalTo(currentFolder || null));
  
  folderListenerUnsub = onValue(q, (snapshot) => {
    folderList.innerHTML = "";
    const data = snapshot.val() || {};
    foldersCache = { ...foldersCache, ...data }; // Cache for names

    if (Object.keys(data).length === 0) {
      folderList.innerHTML = `<div style="text-align:center; padding:10px; color:var(--text-muted); font-size:0.8rem;">Tidak ada folder</div>`;
      return;
    }

    Object.entries(data).forEach(([id, f]) => {
      // Security Check: Hide folders user shouldn't see
      if (f.division !== 'shared' && f.access?.read && !f.access.read[currentUserRole] && currentUserRole !== 'admin') {
        return;
      }

      const card = el("div", "folder-card");
      card.innerHTML = `
        <span>📁 ${f.name}</span>
        <small style="color:var(--text-muted)">${f.fileCount || 0}</small>
      `;
      
      // Click to open folder
      card.onclick = () => {
        currentFolder = id;
        breadcrumbs.push({ id: id, name: f.name });
        renderBreadcrumbs();
        loadFoldersRealtime();
        loadFilesRealtime();
        folderTitle.textContent = f.name;
        // Update drop area text
        dropArea.querySelector('p').textContent = `Add to ${f.name}`;
      };

      // Drag & Drop Handling (Move file to folder)
      card.ondragover = (e) => { e.preventDefault(); card.classList.add("drag-over"); };
      card.ondragleave = () => card.classList.remove("drag-over");
      card.ondrop = (e) => handleMoveFileToFolder(e, id);

      folderList.appendChild(card);
    });
  });
}

// --- 9. REALTIME DATA: FILES (GRID VIEW) ---
function loadFilesRealtime() {
  if (fileListenerUnsub) fileListenerUnsub();

  const q = query(ref(db, "files"), orderByChild("folderId"), equalTo(currentFolder || null));

  fileListenerUnsub = onValue(q, (snapshot) => {
    fileList.innerHTML = "";
    const files = snapshot.val() || {};
    const sortedFiles = Object.entries(files).sort(([,a], [,b]) => b.createdAt - a.createdAt);
    
    if (sortedFiles.length === 0) {
      fileList.innerHTML = `<li style="padding:20px; text-align:center; color:var(--text-muted);">Folder ini kosong</li>`;
      return;
    }

    sortedFiles.forEach(([id, file]) => {
      if (file.deleted) return; // Skip deleted files
      
      const row = createFileRow(id, file, false);
      fileList.appendChild(row);
    });

    attachFileHandlers();
    updateBulkUI(); // Reset bulk selection
  });
}

// --- 10. REALTIME DATA: RECYCLE BIN ---
function loadRecycleBin() {
  if (fileListenerUnsub) fileListenerUnsub();

  const q = query(ref(db, "files"), orderByChild("deleted"), equalTo(true));

  fileListenerUnsub = onValue(q, (snapshot) => {
    fileList.innerHTML = "";
    const files = snapshot.val() || {};
    
    if (Object.keys(files).length === 0) {
      fileList.innerHTML = `<li style="padding:20px; text-align:center; color:var(--text-muted);">Sampah kosong</li>`;
      return;
    }

    Object.entries(files).forEach(([id, file]) => {
      const row = createFileRow(id, file, true);
      fileList.appendChild(row);
    });

    attachRecycleHandlers();
  });
}

// --- 11. ROW CREATION (Grid Layout) ---
function createFileRow(id, file, isRecycle) {
  const row = el("li", "file-row");
  row.dataset.id = id;
  row.draggable = !isRecycle; // Only draggable if active

  const icon = getFileIcon(file.name);

  if (isRecycle) {
    row.innerHTML = `
      <div class="col-check">🗑️</div>
      <div class="col-name" title="${file.name}">${icon} ${file.name}</div>
      <div class="col-size">${formatBytes(file.size)}</div>
      <div class="col-date">${formatDate(file.deletedAt)}</div>
      <div class="col-action">
        <button class="btn icon-only" data-restore="${id}" title="Pulihkan">♻️</button>
        <button class="btn icon-only danger" data-permadelete="${id}" data-path="${file.storagePath}" title="Hapus Permanen">✕</button>
      </div>
    `;
  } else {
    row.innerHTML = `
      <div class="col-check"><input type="checkbox" class="file-checkbox" data-id="${id}"></div>
      <div class="col-name" title="${file.name}">${icon} ${file.name}</div>
      <div class="col-size">${formatBytes(file.size)}</div>
      <div class="col-date">${formatDate(file.createdAt)}</div>
      <div class="col-action">
        <button class="btn icon-only" data-preview="${file.url}" title="Lihat">👁️</button>
        <button class="btn icon-only text-danger" data-delete="${id}" title="Hapus">🗑️</button>
      </div>
    `;
    
    // Drag Start
    row.ondragstart = (e) => {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    };
  }
  return row;
}

// --- 12. FILE ACTIONS & HANDLERS ---
function attachFileHandlers() {
  // Checkbox logic
  const checkboxes = fileList.querySelectorAll(".file-checkbox");
  checkboxes.forEach(cb => {
    cb.onchange = updateBulkUI;
  });

  // Preview
  fileList.querySelectorAll("[data-preview]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openPreview(btn.dataset.preview);
    };
  });

  // Soft Delete
  fileList.querySelectorAll("[data-delete]").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delete;
      if (confirm("Pindahkan file ini ke Recycle Bin?")) {
        await update(ref(db, `files/${id}`), { deleted: true, deletedAt: Date.now() });
        decrementFolderCount(currentFolder);
        showToast("File dipindahkan ke sampah");
      }
    };
  });
}

function attachRecycleHandlers() {
  // Restore
  fileList.querySelectorAll("[data-restore]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.restore;
      await update(ref(db, `files/${id}`), { deleted: false, deletedAt: null });
      // Try to increment folder count (simple approach)
      const fileSnap = await get(ref(db, `files/${id}`));
      if(fileSnap.exists()) incrementFolderCount(fileSnap.val().folderId);
      showToast("File dipulihkan");
    };
  });

  // Permadelete
  fileList.querySelectorAll("[data-permadelete]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.permadelete;
      const path = btn.dataset.path;
      if (confirm("Hapus permanen? Tidak bisa dikembalikan.")) {
        try {
          await remove(ref(db, `files/${id}`));
          if(path) await deleteObject(storageRef(storage, path)).catch(e => console.warn(e));
          showToast("File dihapus selamanya");
        } catch(e) { showToast("Gagal menghapus: " + e.message); }
      }
    };
  });
}

// --- 13. BULK ACTIONS ---
function updateBulkUI() {
  const checkboxes = fileList.querySelectorAll(".file-checkbox:checked");
  const count = checkboxes.length;
  
  if (count > 0) {
    bulkToolbar.style.opacity = "1";
    bulkToolbar.style.pointerEvents = "auto";
  } else {
    bulkToolbar.style.opacity = "0.5";
    bulkToolbar.style.pointerEvents = "none";
  }
}

btnClearSelection.onclick = () => {
  fileList.querySelectorAll(".file-checkbox").forEach(cb => cb.checked = false);
  updateBulkUI();
};

btnBulkDelete.onclick = async () => {
  const selected = Array.from(fileList.querySelectorAll(".file-checkbox:checked")).map(cb => cb.dataset.id);
  if(!selected.length) return;
  
  if(confirm(`Hapus ${selected.length} file terpilih?`)) {
    for(const id of selected) {
      await update(ref(db, `files/${id}`), { deleted: true, deletedAt: Date.now() });
    }
    decrementFolderCount(currentFolder, selected.length);
    showToast(`${selected.length} file dihapus`);
  }
};

btnBulkDownload.onclick = async () => {
  const selected = Array.from(fileList.querySelectorAll(".file-checkbox:checked")).map(cb => cb.dataset.id);
  if(!selected.length) return;
  showToast("Membuka file...");
  for(const id of selected) {
    const snap = await get(ref(db, `files/${id}/url`));
    if(snap.exists()) window.open(snap.val(), "_blank");
  }
};

// --- 14. UPLOAD & DRAG DROP ---
uploadBtn.onclick = () => fileInput.click();
fileInput.onchange = (e) => handleUpload(e.target.files);

dropArea.ondragover = (e) => { e.preventDefault(); dropArea.classList.add("dragover"); };
dropArea.ondragleave = () => dropArea.classList.remove("dragover");
dropArea.ondrop = (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
  handleUpload(e.dataTransfer.files);
};

async function handleUpload(files) {
  if (!files.length || !currentUser) return;
  showToast(`Mengupload ${files.length} file...`);

  for (const file of files) {
    const path = `${currentUser.uid}/${Date.now()}_${file.name}`;
    const fileRef = storageRef(storage, path);
    const task = uploadBytesResumable(fileRef, file);

    try {
      const snapshot = await task;
      const url = await getDownloadURL(snapshot.ref);

      const newFile = {
        name: file.name,
        size: file.size,
        folderId: currentFolder || null,
        owner: currentUser.email,
        storagePath: path,
        url: url,
        createdAt: Date.now(),
        deleted: false
      };

      await push(ref(db, "files"), newFile);
      incrementFolderCount(currentFolder);
      showToast(`✅ ${file.name} selesai`);
    } catch (err) {
      console.error(err);
      showToast(`❌ Gagal: ${file.name}`);
    }
  }
}

// Handle Moving File to Another Folder via Drag & Drop
async function handleMoveFileToFolder(e, targetFolderId) {
  e.preventDefault();
  const fileId = e.dataTransfer.getData("text/plain");
  if (!fileId) return;

  // Validation: Check if source folder is same as target
  const fileSnap = await get(ref(db, `files/${fileId}`));
  if (!fileSnap.exists()) return;
  const fileData = fileSnap.val();
  
  if (fileData.folderId === targetFolderId) return;

  try {
    // Update folderId
    await update(ref(db, `files/${fileId}`), { folderId: targetFolderId });
    
    // Update Counts
    decrementFolderCount(fileData.folderId);
    incrementFolderCount(targetFolderId);
    
    showToast("📦 File dipindahkan");
  } catch (err) {
    showToast("Gagal memindahkan file");
  }
}

// --- 15. FOLDER MANAGEMENT ---
folderForm.onsubmit = async (e) => {
  e.preventDefault();
  const name = folderInput.value.trim();
  if (!name) return;

  try {
    await push(ref(db, "folders"), {
      name: name,
      parentId: currentFolder || null,
      division: currentUserRole, // Inherit creator role logic
      fileCount: 0,
      createdAt: Date.now(),
      access: { read: {[currentUserRole]: true}, write: {[currentUserRole]: true} }
    });
    folderInput.value = "";
    showToast("Folder dibuat");
  } catch (err) {
    showToast("Gagal membuat folder");
  }
};

// Counters
async function incrementFolderCount(fid, amount = 1) {
  if (!fid) return;
  const cRef = ref(db, `folders/${fid}/fileCount`);
  await runTransaction(cRef, (curr) => (curr || 0) + amount);
}
async function decrementFolderCount(fid, amount = 1) {
  if (!fid) return;
  const cRef = ref(db, `folders/${fid}/fileCount`);
  await runTransaction(cRef, (curr) => (curr || 0) - amount > 0 ? (curr || 0) - amount : 0);
}

// --- 16. PREVIEW & SEARCH ---
function openPreview(url) {
  previewBody.innerHTML = `<iframe src="${url}" width="100%" height="100%" style="border:0; background:white;"></iframe>`;
  previewDownload.href = url;
  previewModal.setAttribute("aria-hidden", "false");
}
document.getElementById("close-preview").onclick = () => {
  previewModal.setAttribute("aria-hidden", "true");
  previewBody.innerHTML = ""; // Clear iframe to stop media
};

// Search (Client Side Filtering)
let searchTimer;
globalSearch.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const term = e.target.value.toLowerCase();
    const rows = fileList.querySelectorAll(".file-row");
    rows.forEach(row => {
      const name = row.querySelector(".col-name")?.textContent.toLowerCase() || "";
      row.style.display = name.includes(term) ? "grid" : "none"; // Use grid for layout preservation
    });
  }, 300);
});

// Ctrl+K to Search
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    globalSearch.focus();
  }
});

// --- 17. MOBILE MENU & THEME ---
function toggleMobileMenu() {
  sidebar.classList.toggle("open");
  const isOpen = sidebar.classList.contains("open");
  menuOverlay.style.display = isOpen ? "block" : "none";
}
if(menuToggle) menuToggle.onclick = toggleMobileMenu;
if(menuOverlay) menuOverlay.onclick = toggleMobileMenu;

// Theme Logic
const savedTheme = localStorage.getItem("theme") || "light";
document.documentElement.dataset.theme = savedTheme;
settingsTheme.value = savedTheme;

settingsTheme.addEventListener("change", (e) => {
  const val = e.target.value;
  if (val === "auto") {
    // Check system pref
    const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = sysDark ? "dark" : "light";
  } else {
    document.documentElement.dataset.theme = val;
  }
  localStorage.setItem("theme", val);
});
document.getElementById('toggle-theme').onclick = () => {
  const current = document.documentElement.dataset.theme;
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  settingsTheme.value = next;
  localStorage.setItem("theme", next);
};

// Init
renderBreadcrumbs();
