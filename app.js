import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { 
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, getDocs, query, where, orderBy, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { 
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// === firebase config (tetap) ===
const firebaseConfig = {
  apiKey: "AIzaSyBdKELW2FNsL7H1zB8R765czcDPaSYybdg",
  authDomain: "atlantis-store.firebaseapp.com",
  databaseURL: "https://atlantis-store-default-rtdb.firebaseio.com",
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

// DOM
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginError = document.getElementById("login-error");

const loginSection = document.getElementById("login-section"); // keep legacy if present
const appSection = document.getElementById("app-section"); // legacy
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userInfoSmall = document.getElementById("user-info-small");

const folderForm = document.getElementById("folder-form");
const folderNameInput = document.getElementById("folder-name");
const folderListEl = document.getElementById("folder-list");
const filesSection = document.getElementById("files-section");
const fileList = document.getElementById("file-list");
const uploadBtn = document.getElementById("upload-btn");
const fileInput = document.getElementById("file-input");
const folderTitle = document.getElementById("folder-title");
const dropArea = document.getElementById("drop-area");
const previewModal = document.getElementById("preview-modal");
const previewBody = document.getElementById("preview-body");
const closePreview = document.getElementById("close-preview");
const previewDownload = document.getElementById("preview-download");
const copyLinkBtn = document.getElementById("copy-link");
const globalSearch = document.getElementById("global-search");
const sortSelect = document.getElementById("sort-select");
const bulkDeleteBtn = document.getElementById("bulk-delete");
const selectAllBtn = document.getElementById("select-all");
const fileCountEl = document.getElementById("file-count");
const uploadStatus = document.getElementById("upload-status");
const toggleThemeBtn = document.getElementById("toggle-theme");
const btnRecycle = document.getElementById("btn-recycle");
const btnFolders = document.getElementById("btn-folders");

let currentUser = null;
let currentFolder = null;
let currentFolderName = '';
let filesCache = []; // client cache for search/sort
let selectedFiles = new Set();

// ===== AUTH =====
loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  try {
    const userCred = await signInWithEmailAndPassword(auth, loginEmail.value, loginPassword.value);
    console.log("Login success:", userCred.user.email);
  } catch (err) {
    loginError.textContent = "Login gagal: " + err.message;
  }
});

logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  if (user && user.email === "admin@atlantis.com") {
    currentUser = user;
    // show UI
    document.querySelector(".container").style.display = "flex";
    userInfo.textContent = `Login sebagai: ${user.email}`;
    userInfoSmall.textContent = user.email;
    loadFolders();
  } else {
    currentUser = null;
    // if login section exists, show else hide container
    if (document.getElementById("login-section")) {
      document.getElementById("login-section").style.display = "block";
    }
    document.querySelector(".container").style.display = "none";
  }
});

// ===== FOLDERS =====
function loadFolders(){
  const q = query(collection(db, "folders"), orderBy("createdAt", "desc"));
  onSnapshot(q, snapshot => {
    folderListEl.innerHTML = "";
    snapshot.forEach(docSnap => {
      const f = docSnap.data();
      const id = docSnap.id;
      const card = document.createElement("div");
      card.className = "folder-card";
      card.innerHTML = `
        <div>
          <div class="name">${escapeHtml(f.name)}</div>
          <div class="meta">oleh ${f.createdBy || '-'} • ${f.createdAt ? new Date(f.createdAt.seconds*1000).toLocaleString() : ''}</div>
        </div>
        <div class="actions">
          <button data-id="${id}" class="rename">✏️</button>
          <button data-id="${id}" class="delete">🗑️</button>
        </div>
      `;
      card.addEventListener("click", (ev) => {
        // avoid when clicking action buttons
        if(ev.target.tagName.toLowerCase() === 'button') return;
        selectFolder(id, f.name);
      });
      card.querySelector(".rename").addEventListener("click", (e) => {
        e.stopPropagation();
        renameFolder(id, f.name);
      });
      card.querySelector(".delete").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteFolder(id);
      });
      folderListEl.appendChild(card);
    });
  });
}

folderForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = folderNameInput.value.trim();
  if (!name) return;
  await addDoc(collection(db, "folders"), {
    name,
    createdAt: serverTimestamp(),
    createdBy: currentUser.email
  });
  folderNameInput.value = "";
  logAudit('create_folder', { name });
});

// ===== SELECT FOLDER & LOAD FILES =====
async function selectFolder(folderId, name){
  currentFolder = folderId;
  currentFolderName = name;
  folderTitle.textContent = "📁 " + name;
  uploadBtn.disabled = false;
  fileList.innerHTML = '';
  loadFiles(folderId);
  document.getElementById('breadcrumb').textContent = `Folder / ${name}`;
}

function loadFiles(folderId){
  const q = query(collection(db, "files"), where("folderId","==", folderId), orderBy("createdAt","desc"));
  onSnapshot(q, snapshot => {
    filesCache = [];
    fileList.innerHTML = "";
    snapshot.forEach(docSnap => {
      const f = docSnap.data();
      if(f.deleted) return; // soft-delete filtered out
      const item = {
        id: docSnap.id,
        ...f
      };
      filesCache.push(item);
    });
    renderFiles();
  });
}

function renderFiles(){
  // apply search + sort
  let results = [...filesCache];
  const q = globalSearch.value?.toLowerCase()?.trim();
  if(q){
    results = results.filter(f => (f.name||'').toLowerCase().includes(q));
  }
  const sortBy = sortSelect.value;
  if(sortBy === 'name') results.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  if(sortBy === 'size') results.sort((a,b)=> (b.size||0)-(a.size||0));
  if(sortBy === 'createdAt') results.sort((a,b)=> (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0) ? (b.createdAt.seconds - a.createdAt.seconds) : 0);

  fileList.innerHTML = '';
  results.forEach(f => {
    const li = document.createElement('li');
    li.dataset.id = f.id;
    li.innerHTML = `
      <input type="checkbox" class="file-checkbox" data-id="${f.id}" />
      <div class="file-meta">
        <div class="file-name">${escapeHtml(f.name)}</div>
        <div class="file-sub">${(f.size ? formatBytes(f.size) : '')} • ${f.contentType || ''}</div>
      </div>
      <div class="file-actions">
        <button class="preview" data-id="${f.id}">👁️</button>
        <a class="download" href="${f.downloadURL}" target="_blank" rel="noreferrer">⬇️</a>
        <button class="rename" data-id="${f.id}" data-name="${escapeHtml(f.name)}">✏️</button>
        <button class="delete" data-id="${f.id}" data-path="${f.storagePath}">🗑️</button>
      </div>
    `;
    // checkbox
    li.querySelector('.file-checkbox').addEventListener('change', (e)=>{
      const id = e.target.dataset.id;
      if(e.target.checked) selectedFiles.add(id); else selectedFiles.delete(id);
      toggleBulk();
    });
    li.querySelector('.preview').addEventListener('click', ()=> previewFile(f));
    li.querySelector('.rename').addEventListener('click', ()=> renameFile(f.id, f.name));
    li.querySelector('.delete').addEventListener('click', ()=> softDeleteFile(f.id, f.storagePath));
    fileList.appendChild(li);
  });
  fileCountEl.textContent = `${results.length} file`;
}

function toggleBulk(){
  bulkDeleteBtn.disabled = selectedFiles.size === 0;
}

selectAllBtn?.addEventListener('click', ()=>{
  const checkboxes = document.querySelectorAll('.file-checkbox');
  const all = Array.from(checkboxes);
  const allChecked = all.every(cb=>cb.checked);
  all.forEach(cb=>{
    cb.checked = !allChecked;
    const id = cb.dataset.id;
    if(cb.checked) selectedFiles.add(id); else selectedFiles.delete(id);
  });
  toggleBulk();
});

bulkDeleteBtn?.addEventListener('click', async ()=>{
  if(!confirm("Hapus file terpilih? (akan masuk Recycle Bin)")) return;
  for(const id of selectedFiles){
    await softDeleteFile(id);
  }
  selectedFiles.clear();
  toggleBulk();
});

// ===== UPLOAD (drag & drop + progress) =====
uploadBtn?.addEventListener('click', ()=> fileInput.click());

fileInput?.addEventListener('change', handleFiles);
['dragenter','dragover','dragleave','drop'].forEach(evt=>{
  dropArea.addEventListener(evt, (e)=> e.preventDefault());
});
dropArea.addEventListener('dragover', ()=> dropArea.classList.add('dragover'));
dropArea.addEventListener('dragleave', ()=> dropArea.classList.remove('dragover'));
dropArea.addEventListener('drop', (e)=>{
  dropArea.classList.remove('dragover');
  const files = e.dataTransfer.files;
  handleFiles({ target:{ files }});
});

async function handleFiles(e){
  const files = e.target.files;
  if(!files || !currentFolder) return alert('Pilih folder terlebih dahulu');
  for(const file of files){
    if(file.size > 1024*1024*500){ // example: 500MB limit client check
      alert(`${file.name} melebihi batas ukuran 500MB`);
      continue;
    }
    const path = `uploads/${currentFolder}/${Date.now()}-${file.name}`;
    const ref = storageRef(storage, path);
    const uploadTask = uploadBytesResumable(ref, file);
    // create progress UI element
    const statusEl = document.createElement('div');
    statusEl.textContent = `Uploading ${file.name}`;
    uploadStatus.appendChild(statusEl);
    uploadTask.on('state_changed', (snapshot)=>{
      const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      statusEl.textContent = `Uploading ${file.name} — ${pct}%`;
    }, (err)=>{
      console.error(err);
      statusEl.textContent = `Upload error ${file.name}`;
    }, async ()=>{
      const url = await getDownloadURL(ref);
      await addDoc(collection(db, "files"), {
        name: file.name,
        folderId: currentFolder,
        storagePath: path,
        downloadURL: url,
        size: file.size,
        contentType: file.type,
        createdAt: serverTimestamp(),
        createdBy: currentUser.email
      });
      statusEl.textContent = `Uploaded ${file.name} ✓`;
      setTimeout(()=> statusEl.remove(), 2500);
      logAudit('upload_file', { name: file.name, folder: currentFolderName });
    });
  }
}

// ===== PREVIEW =====
function previewFile(fileObj){
  previewBody.innerHTML = '';
  previewDownload.href = fileObj.downloadURL;
  previewDownload.setAttribute('download', fileObj.name || 'file');
  if(fileObj.contentType && fileObj.contentType.startsWith('image')){
    const img = document.createElement('img');
    img.src = fileObj.downloadURL;
    img.style.maxWidth = '100%';
    previewBody.appendChild(img);
  } else if(fileObj.contentType && fileObj.contentType === 'application/pdf'){
    const iframe = document.createElement('iframe');
    iframe.src = fileObj.downloadURL;
    iframe.style.width = '100%'; iframe.style.height='70vh';
    previewBody.appendChild(iframe);
  } else {
    previewBody.innerHTML = `<p>Tidak dapat preview. Gunakan Download.</p>`;
  }
  previewModal.setAttribute('aria-hidden','false');
}

closePreview.addEventListener('click', ()=> previewModal.setAttribute('aria-hidden','true'));
copyLinkBtn.addEventListener('click', async ()=>{
  const url = previewDownload.href;
  await navigator.clipboard.writeText(url);
  alert('Link disalin ke clipboard');
});

// ===== RENAME, DELETE (soft) =====
window.renameFile = async (id, oldName) => {
  const newName = prompt("Ubah nama file:", oldName);
  if (!newName) return;
  await updateDoc(doc(db, "files", id), { name: newName });
  logAudit('rename_file', { id, oldName, newName });
};

async function softDeleteFile(id, path=null){
  // soft-delete by set deleted:true
  await updateDoc(doc(db, "files", id), { deleted: true, deletedAt: serverTimestamp(), deletedBy: currentUser.email });
  logAudit('soft_delete_file', { id, path });
  alert('File dipindahkan ke Recycle Bin');
}

// rename folder
window.renameFolder = async (id, oldName) => {
  const newName = prompt("Ubah nama folder:", oldName);
  if (!newName) return;
  await updateDoc(doc(db, "folders", id), { name: newName });
  logAudit('rename_folder', { id, oldName, newName });
};

// delete folder + files permanently (use with care)
window.deleteFolder = async (id) => {
  if (!confirm("Hapus folder dan semua file di dalamnya PERMANENT?")) return;
  const q = query(collection(db, "files"), where("folderId", "==", id));
  const snap = await getDocs(q);
  for (const docSnap of snap.docs) {
    const f = docSnap.data();
    try{ await deleteObject(storageRef(storage, f.storagePath)); }catch(e){console.warn(e)}
    await deleteDoc(doc(db, "files", docSnap.id));
  }
  await deleteDoc(doc(db, "folders", id));
  logAudit('delete_folder', { id });
};

// ===== RECYCLE BIN (simple view) =====
btnRecycle?.addEventListener('click', async ()=>{
  // show deleted files across folders
  const q = query(collection(db, "files"), where("deleted","==",true), orderBy("deletedAt","desc"));
  const snap = await getDocs(q);
  const items = [];
  snap.forEach(s => items.push({ id: s.id, ...s.data() }));
  fileList.innerHTML = '';
  items.forEach(f=>{
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="file-meta">
        <div class="file-name">${escapeHtml(f.name)}</div>
        <div class="file-sub">dihapus: ${f.deletedAt ? new Date(f.deletedAt.seconds*1000).toLocaleString() : ''}</div>
      </div>
      <div class="file-actions">
        <button class="restore" data-id="${f.id}">↩️ Restore</button>
        <button class="perma" data-id="${f.id}" data-path="${f.storagePath}">🗑️ Hapus Permanen</button>
      </div>
    `;
    li.querySelector('.restore').addEventListener('click', ()=> restoreFile(f.id));
    li.querySelector('.perma').addEventListener('click', ()=> permaDeleteFile(f.id, f.storagePath));
    fileList.appendChild(li);
  });
});

async function restoreFile(id){
  await updateDoc(doc(db, "files", id), { deleted: false, deletedAt: null, deletedBy: null });
  logAudit('restore_file', { id });
  alert('File dikembalikan');
}

async function permaDeleteFile(id, path){
  if(!confirm('Hapus permanen?')) return;
  try{ await deleteObject(storageRef(storage, path)); }catch(e){console.warn(e)}
  await deleteDoc(doc(db, "files", id));
  logAudit('perma_delete', { id });
  alert('File dihapus permanen');
}

// ===== SEARCH + SORT hooks =====
globalSearch?.addEventListener('input', ()=> renderFiles());
sortSelect?.addEventListener('change', ()=> renderFiles());

// ===== UTILS =====
function formatBytes(bytes, decimals = 2) {
  if(bytes === 0) return '0 B';
  const k = 1024, dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
function escapeHtml(s = '') {
  return s.replace(/[&<>"'`=\/]/g, function (c) { return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;','`':'&#96;','/':'&#47;'}[c]; });
}

// ===== Audit log helper =====
async function logAudit(action, meta = {}){
  try{
    await addDoc(collection(db, 'auditLogs'), {
      action,
      meta,
      user: currentUser?.email || 'unknown',
      ts: serverTimestamp()
    });
  }catch(e){
    console.warn('audit log failed', e);
  }
}

// ===== Theme toggle (dark mode) =====
function initTheme(){
  const t = localStorage.getItem('theme') || 'light';
  if(t === 'dark') document.documentElement.setAttribute('data-theme','dark');
}
toggleThemeBtn?.addEventListener('click', ()=>{
  const cur = document.documentElement.getAttribute('data-theme');
  if(cur === 'dark'){ document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme','light'); }
  else { document.documentElement.setAttribute('data-theme','dark'); localStorage.setItem('theme','dark'); }
});
initTheme();

// ===== Small helpers on load =====
document.addEventListener('DOMContentLoaded', ()=> {
  // hide original login if present
  if(document.getElementById('login-section')) document.getElementById('login-section').style.display = 'none';
  document.querySelector('.container').style.display = 'none';
});
