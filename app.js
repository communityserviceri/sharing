// === Atlantis NAS v3.1 — Enhanced & Stable ===
// Firestore real-time fixed + graceful error handling + UI polish

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
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// --- Firebase config (gunakan punyamu yang valid) ---
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

// --- State ---
let currentUser = null;
let currentFolder = null;
let folderUnsub = null;
let fileUnsub = null;

// --- UI refs ---
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

// --- Helpers ---
function showToast(msg) {
  toast.textContent = msg;
  toast.style.opacity = "0";
  toast.style.display = "block";
  setTimeout(() => (toast.style.opacity = "1"), 10);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => (toast.style.display = "none"), 300);
  }, 2500);
}
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
}

// safer onSnapshot wrapper
function safeOnSnapshot(q, onData, label = "listener") {
  try {
    return onSnapshot(q, onData, (err) => {
      console.warn(`⚠️ Firestore ${label} error:`, err);
      if (err.code === "failed-precondition") {
        showToast("⚠️ Index Firestore belum dibuat. Lihat console.");
      } else if (err.code === "permission-denied") {
        showToast("🚫 Akses database ditolak (cek rules).");
      } else {
        showToast("❌ Gagal konek ke Firestore.");
      }
    });
  } catch (e) {
    console.error(`${label} setup error:`, e);
  }
}

// --- Auth Flow ---
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passInput.value.trim();
  if (!email.endsWith("@atlantis.com")) {
    loginError.textContent = "Gunakan email @atlantis.com untuk login.";
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
    loginError.textContent = "";
  } catch (err) {
    loginError.textContent = "Login gagal: " + err.message;
  }
});
logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    document.getElementById("user-info").textContent = user.email;
    loginSection.style.display = "none";
    appSection.removeAttribute("aria-hidden");
    setTimeout(loadFoldersRealtime, 300);
  } else {
    currentUser = null;
    if (folderUnsub) folderUnsub();
    if (fileUnsub) fileUnsub();
    appSection.setAttribute("aria-hidden", "true");
    loginSection.style.display = "flex";
  }
});

// --- Folder realtime ---
function loadFoldersRealtime() {
  if (!currentUser) return;
  const q = query(
    collection(db, "folders"),
    where("createdBy", "==", currentUser.email),
    orderBy("createdAt", "desc")
  );
  if (folderUnsub) folderUnsub();
  folderUnsub = safeOnSnapshot(
    q,
    (snap) => {
      folderList.innerHTML = "";
      snap.forEach((docu) => {
        const f = docu.data();
        const div = document.createElement("div");
        div.className = "folder-card";
        div.dataset.id = docu.id;
        div.innerHTML = `
          <span>📁 ${f.name}</span>
          <small class="small-muted">${f.fileCount || 0} file</small>`;
        div.onclick = () => openFolder(docu.id, f.name);
        div.ondragover = (e) => {
          e.preventDefault();
          div.classList.add("drag-over");
        };
        div.ondragleave = () => div.classList.remove("drag-over");
        div.ondrop = (e) => handleMoveFiles(e, docu.id);
        folderList.appendChild(div);
      });
    },
    "folders"
  );
}

// --- Create folder ---
folderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = folderInput.value.trim();
  if (!name || !currentUser) return;
  await addDoc(collection(db, "folders"), {
    name,
    createdBy: currentUser.email,
    createdAt: serverTimestamp(),
    fileCount: 0,
  });
  folderInput.value = "";
  showToast("📁 Folder baru dibuat!");
});

// --- Open folder + realtime files ---
function openFolder(id, name) {
  currentFolder = id;
  folderTitle.textContent = "📂 " + name;
  uploadBtn.disabled = false;
  const q = query(
    collection(db, "files"),
    where("folderId", "==", id),
    where("owner", "==", currentUser.email)
  );
  if (fileUnsub) fileUnsub();
  fileUnsub = safeOnSnapshot(
    q,
    (snap) => {
      fileList.innerHTML = "";
      snap.forEach((docu) => {
        const f = docu.data();
        const li = document.createElement("li");
        li.className = "file-row";
        li.draggable = true;
        li.dataset.id = docu.id;
        const created =
          f.createdAt?.seconds
            ? new Date(f.createdAt.seconds * 1000).toLocaleString()
            : "baru";
        li.innerHTML = `
          <div class="file-info">
            <div class="file-meta">
              <span class="file-name">${f.name}</span>
              <span class="file-sub">${formatBytes(f.size)} • ${created}</span>
            </div>
          </div>
          <div class="file-actions">
            <button onclick="previewFile('${f.url}')">👁️</button>
            <button onclick="deleteFile('${docu.id}', '${f.storagePath}')">🗑️</button>
          </div>`;
        li.ondragstart = (e) =>
          e.dataTransfer.setData("text/plain", docu.id);
        fileList.appendChild(li);
      });
    },
    "files"
  );
}

// --- Upload files ---
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
  if (!currentFolder) {
    showToast("Pilih folder dulu!");
    return;
  }
  [...files].forEach((file) => {
    const path = `${currentUser.uid}/${currentFolder}/${file.name}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    const row = document.createElement("li");
    row.className = "file-row";
    row.textContent = `⬆️ Mengunggah ${file.name}...`;
    fileList.prepend(row);

    task.on(
      "state_changed",
      (snap) => {
        const percent = Math.round(
          (snap.bytesTransferred / snap.totalBytes) * 100
        );
        row.textContent = `⬆️ ${file.name} (${percent}%)`;
      },
      (err) => showToast("Upload gagal: " + err.message),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        await addDoc(collection(db, "files"), {
          name: file.name,
          size: file.size,
          folderId: currentFolder,
          owner: currentUser.email,
          storagePath: path,
          url,
          createdAt: serverTimestamp(),
        });
        showToast("✅ Upload selesai: " + file.name);
      }
    );
  });
}

// --- Delete & Move ---
window.deleteFile = async (id, path) => {
  if (!confirm("Hapus file ini?")) return;
  await deleteDoc(doc(db, "files", id));
  await deleteObject(ref(storage, path));
  showToast("🗑️ File dihapus.");
};
async function handleMoveFiles(e, targetFolderId) {
  e.preventDefault();
  const fileId = e.dataTransfer.getData("text/plain");
  await updateDoc(doc(db, "files", fileId), { folderId: targetFolderId });
  showToast("📦 File berhasil dipindahkan!");
  e.target.classList.remove("drag-over");
}

// --- Preview Modal ---
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

// --- Search ---
globalSearch.addEventListener("input", () => {
  const term = globalSearch.value.toLowerCase();
  [...fileList.children].forEach((li) => {
    const name =
      li.querySelector(".file-name")?.textContent.toLowerCase() || "";
    li.style.display = name.includes(term) ? "" : "none";
  });
});

// --- Theme toggle ---
const themeBtn = document.getElementById("toggle-theme");
themeBtn.onclick = () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
};
document.documentElement.dataset.theme =
  localStorage.getItem("theme") ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light");

console.log("✅ Atlantis NAS v3.1 initialized");
