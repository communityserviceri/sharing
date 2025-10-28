// app.js — Atlantis NAS v2.0 (fixed & improved)
// Firebase SDK Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

/* =======================
   CONFIG
   ======================= */
const firebaseConfig = {
  apiKey: "AIzaSyBdKELW2FNsL7H1zB8R765czcDPaSYybdg",
  authDomain: "atlantis-store.firebaseapp.com",
  projectId: "atlantis-store",
  storageBucket: "atlantis-store.appspot.com",
  messagingSenderId: "566295949160",
  appId: "1:566295949160:web:2edd2bd1c4b74277a5f0dd",
  measurementId: "G-ERXQQKY7HM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

/* =======================
   SAFE DOM ACCESS HELPER
   ======================= */
function $(id) {
  return document.getElementById(id);
}
function safeDisplay(el, display) {
  if (el && el.style) el.style.display = display;
}

/* =======================
   DOM References
   ======================= */
let loginSection, loginForm, loginEmail, loginPassword, loginError,
  appSection, userInfo, logoutBtn, folderForm, folderNameInput, folderList,
  foldersSection, filesSection, folderTitle, uploadBtn, fileInput, dropArea, fileList,
  previewModal, previewBody, closePreview, previewDownload, toastEl,
  globalSearch, sortSelect, tabFiles, tabRecycle, tabSettings, toggleThemeBtn;

/* =======================
   Wait for DOM Ready
   ======================= */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize all DOM elements safely
  loginSection = $("login-section");
  loginForm = $("login-form");
  loginEmail = $("login-email");
  loginPassword = $("login-password");
  loginError = $("login-error");

  appSection = $("app-section");
  userInfo = $("user-info");
  logoutBtn = $("logout-btn");

  folderForm = $("folder-form");
  folderNameInput = $("folder-name");
  folderList = $("folder-list");

  foldersSection = $("folders-section");
  filesSection = $("files-section");
  folderTitle = $("folder-title");

  uploadBtn = $("upload-btn");
  fileInput = $("file-input");
  dropArea = $("drop-area");
  fileList = $("file-list");

  previewModal = $("preview-modal");
  previewBody = $("preview-body");
  closePreview = $("close-preview");
  previewDownload = $("preview-download");

  toastEl = $("toast");

  globalSearch = $("global-search");
  sortSelect = $("sort-select");
  tabFiles = $("tab-files");
  tabRecycle = $("tab-recycle");
  tabSettings = $("tab-settings");
  toggleThemeBtn = $("toggle-theme");

  // Default visibility
  safeDisplay(appSection, 'none');
  safeDisplay(loginSection, 'flex');

  initTheme();
  initAuthHandlers();
  initFolderHandlers();
  initUploadHandlers();
  initSearchAndSort();
  initKeyboardShortcuts();
});

/* =======================
   THEME
   ======================= */
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else if (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  toggleThemeBtn?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    if (cur === 'dark') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }
  });
}

/* =======================
   AUTH HANDLERS
   ======================= */
function initAuthHandlers() {
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) return;
    loginError.textContent = '';
    try {
      await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value);
    } catch (err) {
      console.error('Login error:', err);
      loginError.textContent = "Login gagal: " + (err.message || err.code || 'unknown');
    }
  });

  logoutBtn?.addEventListener('click', async () => {
    await signOut(auth);
    toast('Logged out');
  });

  onAuthStateChanged(auth, async (user) => {
    if (user && user.email?.toLowerCase().endsWith('@atlantis.com')) {
      safeDisplay(loginSection, 'none');
      safeDisplay(appSection, 'flex');
      userInfo.textContent = user.email;
      await loadFoldersRealtime();
      toast(`Selamat datang, ${user.email}`);
    } else {
      safeDisplay(appSection, 'none');
      safeDisplay(loginSection, 'flex');
      if (user && !user.email?.toLowerCase().endsWith('@atlantis.com')) {
        await signOut(auth);
        loginError.textContent = 'Hanya akun @atlantis.com yang diperbolehkan.';
      }
    }
  });
}

/* =======================
   UTILITIES (TOAST, BYTES, etc)
   ======================= */
function toast(msg, timeout = 3000) {
  if (!toastEl) return alert(msg);
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  setTimeout(() => (toastEl.style.display = 'none'), timeout);
}
function formatBytes(bytes = 0) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
function escapeHtml(s = '') {
  return s.replace(/[&<>"]+/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* =======================
   FOLDERS HANDLING
   ======================= */
async function loadFoldersRealtime() {
  const q = query(collection(db, 'folders'), orderBy('createdAt', 'desc'));
  onSnapshot(q, (snapshot) => {
    folderList.innerHTML = '';
    snapshot.forEach((docSnap) => {
      const f = docSnap.data();
      const card = document.createElement('div');
      card.className = 'folder-card';
      card.textContent = f.name || '(Tanpa nama)';
      card.onclick = () => selectFolder(docSnap.id, f.name);
      folderList.appendChild(card);
    });
  });
}

function initFolderHandlers() {
  folderForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = folderNameInput.value.trim();
    if (!name) return;
    await addDoc(collection(db, 'folders'), {
      name,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.email || 'anon'
    });
    folderNameInput.value = '';
    toast('Folder dibuat');
  });
}

/* =======================
   UPLOAD HANDLERS
   ======================= */
function initUploadHandlers() {
  uploadBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files?.length) handleUploadFiles(files);
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    dropArea?.addEventListener(ev, (e) => {
      e.preventDefault();
      dropArea.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropArea?.addEventListener(ev, (e) => {
      e.preventDefault();
      dropArea.classList.remove('dragover');
    });
  });
  dropArea?.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files?.length) handleUploadFiles(files);
  });
}

async function handleUploadFiles(files) {
  toast(`Mengunggah ${files.length} file...`);
  // Tambahkan logika upload di sini sesuai kebutuhanmu
}

/* =======================
   SEARCH, SORT, SHORTCUTS
   ======================= */
function initSearchAndSort() {
  globalSearch?.addEventListener('input', () => toast('Searching...'));
  sortSelect?.addEventListener('change', () => toast('Sorting...'));
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') previewModal?.setAttribute('aria-hidden', 'true');
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      globalSearch?.focus();
    }
  });
}
