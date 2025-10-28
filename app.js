// app.js — Atlantis NAS v2.0 (full, fixed & safe)
// Firebase SDK Imports (v11)
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
   CONFIG — sesuaikan kalau perlu
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
   SAFE DOM HELPERS
   ======================= */
const $ = (id) => document.getElementById(id);
function safeDisplay(el, display) { if (el && el.style) el.style.display = display; }
function safeText(el, text) { if (el) el.textContent = text; }
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('data-')) e.setAttribute(k, attrs[k]);
    else if (k === 'html') e.innerHTML = attrs[k];
    else e[k] = attrs[k];
  }
  children.flat().forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c instanceof Node) e.appendChild(c);
  });
  return e;
}

/* =======================
   DOM references (initialized on DOMContentLoaded)
   ======================= */
let loginSection, loginForm, loginEmail, loginPassword, loginError;
let appSection, userInfo, logoutBtn;
let folderForm, folderNameInput, folderList;
let foldersSection, filesSection, folderTitle;
let uploadBtn, fileInput, dropArea, fileList;
let previewModal, previewBody, closePreview, previewDownload;
let toastEl, globalSearch, sortSelect, tabFiles, tabRecycle, tabSettings, toggleThemeBtn;

/* =======================
   App State
   ======================= */
let currentUser = null;
let currentFolderId = null;
let currentFolderName = '';
let filesCache = [];
let selectedFiles = new Set();
let uploadTasks = new Map();
let foldersUnsub = null;
let filesUnsub = null;

/* =======================
   Utilities
   ======================= */
function toast(message, timeout = 3000) {
  if (!toastEl) return alert(message);
  toastEl.textContent = message;
  toastEl.style.display = 'block';
  setTimeout(() => { toastEl.style.display = 'none'; }, timeout);
}
function formatBytes(bytes = 0, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
function escapeHtml(s = '') {
  return (s || '').replace(/[&<>"'`=\/]/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;','/':'&#47;'}[c];
  });
}
function fileIconFor(file) {
  const mime = (file.contentType || file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (mime.startsWith('image/')) return '🖼️';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return '📄';
  if (mime.startsWith('video/')) return '🎞️';
  if (mime.includes('zip') || name.endsWith('.zip') || name.endsWith('.rar')) return '🗜️';
  if (mime.includes('excel') || name.endsWith('.xls') || name.endsWith('.xlsx')) return '📊';
  if (mime.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) return '📃';
  if (mime.includes('presentation') || name.endsWith('.ppt') || name.endsWith('.pptx')) return '📽️';
  if (mime.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) return '📝';
  return '📁';
}

/* =======================
   THEME: init + toggle
   ======================= */
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) document.documentElement.setAttribute('data-theme', 'dark');
  }
  toggleThemeBtn?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    if (cur === 'dark') { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme', 'light'); }
    else { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('theme', 'dark'); }
  });
}

/* =======================
   AUTH: handlers + safe UI updates
   ======================= */
function initAuth() {
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) return;
    loginError.textContent = '';
    try {
      await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value);
      // onAuthStateChanged will handle UI
    } catch (err) {
      console.error('Login error:', err);
      loginError.textContent = "Login gagal: " + (err?.message || err?.code || 'unknown');
    }
  });

  logoutBtn?.addEventListener('click', async () => {
    try { await signOut(auth); toast('Logged out'); } catch(e) { console.warn(e); }
  });

  onAuthStateChanged(auth, async (user) => {
    if (user && typeof user.email === 'string' && user.email.toLowerCase().endsWith('@atlantis.com')) {
      currentUser = user;
      safeDisplay(loginSection, 'none');
      safeDisplay(appSection, 'flex');
      safeText(userInfo, `${user.email}`);
      await loadFoldersRealtime();
      showTab('files');
      toast(`Selamat datang, ${user.email}`);
    } else {
      currentUser = null;
      safeDisplay(appSection, 'none');
      safeDisplay(loginSection, 'flex');
      if (user && !user.email.toLowerCase().endsWith('@atlantis.com')) {
        try { await signOut(auth); } catch(e){}
        if (loginError) loginError.textContent = 'Hanya akun @atlantis.com yang diperbolehkan.';
      }
    }
  });
}

/* =======================
   FOLDERS: realtime load + create
   ======================= */
async function loadFoldersRealtime() {
  if (!folderList) return;
  if (foldersUnsub) { foldersUnsub(); foldersUnsub = null; }
  try {
    const q = query(collection(db, 'folders'), orderBy('createdAt','desc'));
    foldersUnsub = onSnapshot(q, snapshot => {
      folderList.innerHTML = '';
      if (snapshot.empty) {
        const hint = el('div', { class: 'folder-card' }, el('div', {}, 'Belum ada folder. Buat folder baru di atas.'));
        folderList.appendChild(hint);
        return;
      }
      snapshot.forEach(docSnap => {
        const f = docSnap.data();
        const id = docSnap.id;
        const card = el('div', { class: 'folder-card', 'data-id': id },
          el('div', { class: 'folder-title' }, `${fileIconFor({name:f.name})} ${escapeHtml(f.name)}`),
          el('div', { class: 'folder-meta' }, f.createdBy || '')
        );
        card.addEventListener('click', () => selectFolder(id, f.name));
        folderList.appendChild(card);
      });
    }, err => { console.error('Folder listen error', err); });
  } catch (err) { console.error('loadFoldersRealtime err', err); }
}

folderForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = folderNameInput?.value?.trim();
  if (!name || !currentUser) return;
  try {
    await addDoc(collection(db, 'folders'), { name, createdAt: serverTimestamp(), createdBy: currentUser.email });
    if (folderNameInput) folderNameInput.value = '';
    toast('Folder dibuat');
    logAudit('create_folder', { name });
  } catch (err) { console.error(err); toast('Gagal membuat folder'); }
});

/* =======================
   SELECT FOLDER & FILES realtime
   ======================= */
function selectFolder(folderId, name) {
  currentFolderId = folderId;
  currentFolderName = name;
  if (folderTitle) folderTitle.textContent = `📁 ${name}`;
  if (uploadBtn) uploadBtn.disabled = false;
  filesSection?.classList.remove('hidden');
  if (filesUnsub) { filesUnsub(); filesUnsub = null; }
  const q = query(collection(db, 'files'), where('folderId','==',folderId), orderBy('createdAt','desc'));
  filesUnsub = onSnapshot(q, snapshot => {
    filesCache = [];
    snapshot.forEach(docSnap => filesCache.push({ id: docSnap.id, ...docSnap.data() }));
    renderFileList();
  }, err => console.error('files listen err', err));
}

/* =======================
   RENDER FILE LIST
   ======================= */
function renderFileList() {
  if (!fileList) return;
  let results = filesCache.filter(f => !f.deleted);
  const q = (globalSearch?.value || '').trim().toLowerCase();
  if (q) results = results.filter(f => (f.name||'').toLowerCase().includes(q));
  const sortBy = sortSelect?.value || 'createdAt';
  if (sortBy === 'name') results.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  else if (sortBy === 'size') results.sort((a,b)=> (b.size||0) - (a.size||0));
  else { // createdAt
    results.sort((a,b)=> {
      const ta = a.createdAt?.seconds || a.createdAt || 0;
      const tb = b.createdAt?.seconds || b.createdAt || 0;
      return tb - ta;
    });
  }

  fileList.innerHTML = '';
  results.forEach(f => {
    const row = el('li', { class: 'file-row', 'data-id': f.id },
      el('div', { class: 'file-info' },
        el('input', { type: 'checkbox', class: 'file-checkbox', onchange: () => toggleSelectFile(f.id) }),
        el('div', { class: 'file-icon' }, fileIconFor(f)),
        el('div', { class: 'file-meta' },
          el('div', { class: 'file-name' }, escapeHtml(f.name || '—')),
          el('div', { class: 'file-sub' }, `${formatBytes(f.size||0)} • ${f.contentType || ''}`)
        )
      ),
      el('div', { class: 'file-actions' },
        el('button', { class: 'btn-action preview-btn', title: 'Preview' }, '👁️'),
        el('a', { class: 'btn-action dl', href: f.downloadURL || '#', target: '_blank', rel: 'noreferrer', title: 'Download' }, '⬇️'),
        el('button', { class: 'btn-action rename-btn', title: 'Rename' }, '✏️'),
        el('button', { class: 'btn-action delete-btn', title: 'Delete' }, '🗑️')
      )
    );

    // safe attach handlers
    const previewBtn = row.querySelector('.preview-btn'); if (previewBtn) previewBtn.addEventListener('click', () => previewFile(f));
    const renameBtn = row.querySelector('.rename-btn'); if (renameBtn) renameBtn.addEventListener('click', () => renameFilePrompt(f));
    const deleteBtn = row.querySelector('.delete-btn'); if (deleteBtn) deleteBtn.addEventListener('click', () => softDeleteFile(f.id));
    const cb = row.querySelector('.file-checkbox'); if (cb) cb.checked = selectedFiles.has(f.id);
    fileList.appendChild(row);
  });
  updateFloatingToolbar();
}

/* =======================
   Selection + floating toolbar
   ======================= */
function toggleSelectFile(id) { if (selectedFiles.has(id)) selectedFiles.delete(id); else selectedFiles.add(id); updateFloatingToolbar(); }
function clearSelection() { selectedFiles.clear(); document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = false); updateFloatingToolbar(); }
function updateFloatingToolbar() {
  const selectedCount = selectedFiles.size;
  let bulkControls = document.getElementById('bulk-controls');
  if (!bulkControls && selectedCount > 0) {
    bulkControls = el('div', { id: 'bulk-controls', class: 'bulk-controls' },
      el('span', {}, `${selectedCount} terpilih`),
      el('button', { id: 'bulk-download' }, '⬇️ Download'),
      el('button', { id: 'bulk-delete' }, '🗑️ Hapus'),
      el('button', { id: 'bulk-clear' }, '✖ Clear')
    );
    document.body.appendChild(bulkControls);
    document.getElementById('bulk-clear')?.addEventListener('click', () => { clearSelection(); bulkControls.remove(); });
    document.getElementById('bulk-delete')?.addEventListener('click', async () => {
      if (!confirm('Hapus file terpilih? (akan masuk Recycle Bin)')) return;
      for (const id of Array.from(selectedFiles)) { await softDeleteFile(id); }
      clearSelection(); bulkControls.remove(); toast('File dipindahkan ke Recycle Bin');
    });
    document.getElementById('bulk-download')?.addEventListener('click', () => { toast('Untuk download banyak file, gunakan fitur Zip server-side (Cloud Function).'); });
  } else if (bulkControls && selectedCount === 0) {
    bulkControls.remove();
  } else if (bulkControls) {
    bulkControls.querySelector('span').textContent = `${selectedCount} terpilih`;
  }
}

/* =======================
   UPLOAD: drag/drop + progress
   ======================= */
function initUploadHandlers() {
  uploadBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', (e) => { const files = e.target.files; if (files?.length) handleUploadFiles(files); });
  ['dragenter','dragover'].forEach(ev => { dropArea?.addEventListener(ev, (e)=>{ e.preventDefault(); dropArea.classList.add('dragover'); }); });
  ['dragleave','drop'].forEach(ev => { dropArea?.addEventListener(ev,(e)=>{ e.preventDefault(); dropArea.classList.remove('dragover'); }); });
  dropArea?.addEventListener('drop', (e) => { const files = e.dataTransfer?.files; if (files?.length) handleUploadFiles(files); });
}

async function handleUploadFiles(fileListObj) {
  if (!currentFolderId) { toast('Pilih folder tujuan terlebih dahulu'); return; }
  for (const file of Array.from(fileListObj)) {
    if (file.size > 1024 * 1024 * 1024) { toast(`${file.name} terlalu besar (>1GB)`); continue; }
    const uploadingRow = el('div', { class: 'upload-row' },
      el('div', {}, `Uploading ${escapeHtml(file.name)} `),
      el('div', { class: 'progress-bar' }, el('div', { class: 'progress-fill', style: 'width:0%' })),
      el('button', { class: 'cancel-upload' }, 'Cancel')
    );
    document.body.appendChild(uploadingRow);
    const path = `uploads/${currentFolderId}/${Date.now()}-${file.name}`;
    const sRef = storageRef(storage, path);
    const task = uploadBytesResumable(sRef, file);
    uploadTasks.set(path, task);
    uploadingRow.querySelector('.cancel-upload')?.addEventListener('click', () => { try { task.cancel(); uploadTasks.delete(path); uploadingRow.remove(); toast('Upload dibatalkan'); } catch(e){ console.warn(e); } });
    task.on('state_changed', (snap) => {
      const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      const fill = uploadingRow.querySelector('.progress-fill'); if (fill) fill.style.width = `${pct}%`;
    }, (err) => { console.error('upload error', err); uploadingRow.remove(); toast(`Upload gagal: ${file.name}`); }, async () => {
      const url = await getDownloadURL(sRef);
      try {
        await addDoc(collection(db, 'files'), {
          name: file.name,
          folderId: currentFolderId,
          storagePath: path,
          downloadURL: url,
          size: file.size,
          contentType: file.type,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.email || 'unknown'
        });
        uploadingRow.remove();
        toast(`Upload sukses: ${file.name}`);
        logAudit('upload_file', { name: file.name, folder: currentFolderName });
      } catch (err) { console.error('write metadata error', err); toast(`Gagal menyimpan metadata: ${file.name}`); }
      uploadTasks.delete(path);
    });
  }
}

/* =======================
   Preview modal
   ======================= */
function previewFile(fileObj) {
  if (!previewModal || !previewBody) return;
  previewBody.innerHTML = '';
  previewDownload.href = fileObj.downloadURL || '#';
  previewDownload.setAttribute('download', fileObj.name || 'file');
  if ((fileObj.contentType || '').startsWith('image/')) {
    const img = el('img', { src: fileObj.downloadURL, style: 'max-width:100%;height:auto' }); previewBody.appendChild(img);
  } else if ((fileObj.contentType || '') === 'application/pdf' || (fileObj.name||'').toLowerCase().endsWith('.pdf')) {
    const iframe = el('iframe', { src: fileObj.downloadURL, style: 'width:100%;height:70vh;border:none' }); previewBody.appendChild(iframe);
  } else { previewBody.innerHTML = `<p>Tidak dapat preview. Silakan download.</p>`; }
  previewModal.setAttribute('aria-hidden', 'false');
}
closePreview?.addEventListener('click', () => previewModal?.setAttribute('aria-hidden','true'));

/* =======================
   Rename, soft delete, restore, perma delete
   ======================= */
async function renameFilePrompt(fileObj) {
  const newName = prompt('Ubah nama file:', fileObj.name);
  if (!newName || newName.trim() === '' || newName === fileObj.name) return;
  try { await updateDoc(doc(db, 'files', fileObj.id), { name: newName }); toast('Nama file diperbarui'); logAudit('rename_file', { id: fileObj.id, oldName: fileObj.name, newName }); }
  catch (err) { console.error(err); toast('Gagal mengganti nama file'); }
}
async function softDeleteFile(fileId) {
  if (!confirm('Hapus file ini? Akan dipindahkan ke Recycle Bin')) return;
  try { await updateDoc(doc(db, 'files', fileId), { deleted: true, deletedAt: serverTimestamp(), deletedBy: currentUser?.email || 'unknown' }); toast('File dipindahkan ke Recycle Bin'); logAudit('soft_delete', { id: fileId }); }
  catch (err) { console.error(err); toast('Gagal menghapus file'); }
}
async function restoreFile(fileId) { try { await updateDoc(doc(db, 'files', fileId), { deleted: false, deletedAt: null, deletedBy: null }); toast('File dipulihkan'); logAudit('restore_file', { id: fileId }); } catch (err) { console.error(err); toast('Gagal restore file'); } }
async function permaDeleteFile(fileId, storagePath) {
  if (!confirm('Hapus permanen file? Tindakan ini tidak bisa dibatalkan.')) return;
  try {
    if (storagePath) { try { await deleteObject(storageRef(storage, storagePath)); } catch (e) { console.warn('storage delete warn', e); } }
    await deleteDoc(doc(db, 'files', fileId));
    toast('File dihapus permanen');
    logAudit('perma_delete', { id: fileId });
  } catch (err) { console.error(err); toast('Gagal menghapus permanen'); }
}

/* =======================
   Recycle view
   ======================= */
tabRecycle?.addEventListener('click', async () => {
  showTab('recycle');
  try {
    const q = query(collection(db, 'files'), where('deleted','==',true), orderBy('deletedAt','desc'));
    const snap = await getDocs(q);
    fileList.innerHTML = '';
    snap.forEach(docSnap => {
      const f = { id: docSnap.id, ...docSnap.data() };
      const row = el('li', { class: 'file-row deleted' },
        el('div', { class: 'file-info' },
          el('div', { class: 'file-icon' }, fileIconFor(f)),
          el('div', { class: 'file-meta' },
            el('div', { class: 'file-name' }, escapeHtml(f.name || '—')),
            el('div', { class: 'file-sub' }, `Dihapus: ${f.deletedAt ? new Date(f.deletedAt.seconds*1000).toLocaleString() : '-'}`)
          )
        ),
        el('div', { class: 'file-actions' },
          el('button', { class: 'btn-action restore-btn' }, '↩️ Restore'),
          el('button', { class: 'btn-action perma-btn' }, '🗑️ Hapus Permanen')
        )
      );
      row.querySelector('.restore-btn')?.addEventListener('click', () => restoreFile(f.id));
      row.querySelector('.perma-btn')?.addEventListener('click', () => permaDeleteFile(f.id, f.storagePath));
      fileList.appendChild(row);
    });
  } catch (err) { console.error('recycle view err', err); }
});

/* =======================
   Tabs
   ======================= */
tabFiles?.addEventListener('click', () => showTab('files'));
tabSettings?.addEventListener('click', () => showTab('settings'));
function showTab(name) {
  [tabFiles, tabRecycle, tabSettings].forEach(b => b?.classList?.remove('active'));
  if (name === 'files') tabFiles?.classList?.add('active');
  if (name === 'recycle') tabRecycle?.classList?.add('active');
  if (name === 'settings') tabSettings?.classList?.add('active');
  if (foldersSection) foldersSection.style.display = (name === 'files') ? 'block' : 'none';
  if (filesSection) filesSection.style.display = (name === 'files' && currentFolderId) ? 'block' : (name === 'files' ? 'none' : filesSection.style.display);
  if (name === 'settings' && fileList) {
    fileList.innerHTML = '';
    const settingsCard = el('div', { class: 'folder-card' }, el('div', {}, 'Pengaturan akan datang (roles, security rules guidance).'));
    fileList.appendChild(settingsCard);
  }
}

/* =======================
   Audit logging
   ======================= */
async function logAudit(action, meta = {}) {
  try { await addDoc(collection(db, 'auditLogs'), { action, meta, user: currentUser?.email || 'unknown', ts: serverTimestamp() }); }
  catch (err) { console.warn('Audit log failed', err); }
}

/* =======================
   Search & sort live
   ======================= */
globalSearch?.addEventListener('input', () => renderFileList());
sortSelect?.addEventListener('change', () => renderFileList());

/* =======================
   Keyboard shortcuts
   ======================= */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { previewModal?.setAttribute('aria-hidden','true'); clearSelection(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); globalSearch?.focus(); }
});

/* =======================
   Initial setup after DOM ready
   ======================= */
document.addEventListener('DOMContentLoaded', () => {
  // grab references (some may already be set above via module load)
  loginSection = loginSection || $('login-section');
  loginForm = loginForm || $('login-form');
  loginEmail = loginEmail || $('login-email');
  loginPassword = loginPassword || $('login-password');
  loginError = loginError || $('login-error');
  appSection = appSection || $('app-section');
  userInfo = userInfo || $('user-info');
  logoutBtn = logoutBtn || $('logout-btn');
  folderForm = folderForm || $('folder-form');
  folderNameInput = folderNameInput || $('folder-name');
  folderList = folderList || $('folder-list');
  foldersSection = foldersSection || $('folders-section');
  filesSection = filesSection || $('files-section');
  folderTitle = folderTitle || $('folder-title');
  uploadBtn = uploadBtn || $('upload-btn');
  fileInput = fileInput || $('file-input');
  dropArea = dropArea || $('drop-area');
  fileList = fileList || $('file-list');
  previewModal = previewModal || $('preview-modal');
  previewBody = previewBody || $('preview-body');
  closePreview = closePreview || $('close-preview');
  previewDownload = previewDownload || $('preview-download');
  toastEl = toastEl || $('toast');
  globalSearch = globalSearch || $('global-search');
  sortSelect = sortSelect || $('sort-select');
  tabFiles = tabFiles || $('tab-files');
  tabRecycle = tabRecycle || $('tab-recycle');
  tabSettings = tabSettings || $('tab-settings');
  toggleThemeBtn = toggleThemeBtn || $('toggle-theme');

  // initial visibility
  safeDisplay(appSection, 'none');
  safeDisplay(loginSection, 'flex');

  // init modules
  initTheme();
  initAuth();
  initUploadHandlers();

  // attach remaining handlers that may rely on DOM
  globalSearch?.addEventListener('input', () => renderFileList());
  sortSelect?.addEventListener('change', () => renderFileList());
  tabFiles?.addEventListener('click', () => showTab('files'));
  tabSettings?.addEventListener('click', () => showTab('settings'));
  closePreview?.addEventListener('click', () => previewModal?.setAttribute('aria-hidden','true'));

});

/* =======================
   End of file — full-featured app.js
   ======================= */
