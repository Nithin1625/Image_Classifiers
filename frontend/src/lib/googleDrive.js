// src/lib/googleDrive.js
// Direct Google Drive API v3 Service (Zero Local or Server Disk Storage)

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

// Helper: Authenticated fetch that automatically calls window.__refreshGoogleToken() on 401 and retries once
async function driveFetch(url, options = {}, token) {
  let currentToken = token;
  const headers = new Headers(options.headers || {});
  if (currentToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${currentToken}`);
  }

  let res = await fetch(url, { ...options, headers });

  // If 401 Unauthorized, automatically request a refreshed token and retry once
  if (res.status === 401 && typeof window !== "undefined" && window.__refreshGoogleToken) {
    try {
      const newToken = await window.__refreshGoogleToken();
      if (newToken) {
        headers.set("Authorization", `Bearer ${newToken}`);
        res = await fetch(url, { ...options, headers });
      }
    } catch (err) {
      console.warn("driveFetch automatic retry error:", err);
    }
  }

  return res;
}

// 1. Find a folder in Google Drive (does not create)
async function findFolder(token, folderName, parentId = null) {
  let query = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const searchRes = await driveFetch(
    `${DRIVE_API}?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    {},
    token
  );
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0];
  }
  return null;
}

// 2. Check if workspace already exists in Drive (zero creation)
export async function findDriveWorkspace(token) {
  const root = await findFolder(token, "Image_Classifier");
  if (!root) return null;
  const input = await findFolder(token, "input", root.id);
  const output = await findFolder(token, "output", root.id);
  if (!input) return null;
  return {
    rootId: root.id,
    inputId: input.id,
    outputId: output ? output.id : null
  };
}

// 2b. Find workspace by custom root folder ID (when user picks a folder from Google Drive)
export async function findDriveWorkspaceByRootId(token, rootId) {
  let actualRootId = rootId;
  try {
    const metaRes = await driveFetch(`${DRIVE_API}/${rootId}?fields=id,name,parents`, {}, token);
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if ((meta.name === "output" || meta.name === "input") && meta.parents && meta.parents.length > 0) {
        actualRootId = meta.parents[0];
      }
    }
  } catch (err) {
    console.warn("Could not resolve folder parent:", err);
  }

  const input = await findFolder(token, "input", actualRootId);
  const output = await findFolder(token, "output", actualRootId);
  return {
    rootId: actualRootId,
    inputId: input ? input.id : actualRootId,
    outputId: output ? output.id : null,
    hasInputFolder: !!input
  };
}

// 2c. Fetch all folders across Google Drive (zero local storage)
async function getAllDriveFolders(token) {
  let query = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  let allFolders = [];
  let pageToken = null;

  try {
    do {
      const url = `${DRIVE_API}?q=${encodeURIComponent(query)}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)&pageSize=1000&orderBy=name${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const res = await driveFetch(url, {}, token);
      if (!res.ok) break;
      const data = await res.json();
      if (data.files) {
        allFolders = allFolders.concat(data.files);
      }
      pageToken = data.nextPageToken;
    } while (pageToken && allFolders.length < 3000);
  } catch (err) {
    console.error("Error fetching all drive folders:", err);
  }

  return allFolders.filter(f => f.name !== "input" && f.name !== "output");
}

// 2d. List items inside a specific folder (or all folders when folderId is null)
export async function listDriveFolderContents(token, folderId = null) {
  // If at root level ("My Drive"), return all user folders across Google Drive
  if (!folderId || folderId === "root") {
    try {
      const [folders, rootFilesRes] = await Promise.all([
        getAllDriveFolders(token),
        driveFetch(
          `${DRIVE_API}?q=${encodeURIComponent("mimeType != 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents")}&fields=files(id,name,mimeType,size,modifiedTime,parents)&pageSize=1000`,
          {},
          token
        ).then(r => r.ok ? r.json() : { files: [] })
      ]);

      const rootFiles = rootFilesRes.files || [];
      return [...folders, ...rootFiles];
    } catch (err) {
      console.error("Failed to list root drive contents:", err);
      return [];
    }
  }

  // Inside a specific folder: fetch all direct children (subfolders and files)
  const query = `'${folderId}' in parents and trashed = false`;
  const res = await driveFetch(
    `${DRIVE_API}?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size,modifiedTime,parents)&pageSize=1000&orderBy=folder,name`,
    {},
    token
  );
  if (!res.ok) return [];
  const data = await res.json();
  const files = data.files || [];
  return files.filter(f => f.name !== "input" && f.name !== "output");
}

// 2e. Search all files and folders in Google Drive
export async function searchAllDriveFiles(token) {
  const query = "trashed = false";
  const res = await driveFetch(
    `${DRIVE_API}?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size,modifiedTime,parents)&pageSize=1000`,
    {},
    token
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.files || [];
}

// 3. Find or create a folder in Google Drive
async function createFolder(token, folderName, parentId = null) {
  const meta = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
    parents: parentId ? [parentId] : []
  };

  const createRes = await driveFetch(
    DRIVE_API,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(meta)
    },
    token
  );

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(errData.error?.message || "Failed to create folder in Google Drive");
  }

  return await createRes.json();
}

async function getOrCreateFolder(token, folderName, parentId = null) {
  const existing = await findFolder(token, folderName, parentId);
  if (existing) return existing;

  return await createFolder(token, folderName, parentId);
}

// 4. List all class folders inside input/ and count their files
export async function listDriveClasses(token, inputFolderId) {
  const query = `'${inputFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await driveFetch(
    `${DRIVE_API}?q=${encodeURIComponent(query)}&pageSize=100&fields=files(id,name)&orderBy=name`,
    {
      headers: {
        "Cache-Control": "no-cache"
      }
    },
    token
  );
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  const allFolders = data.files || [];
  // Exclude internal system folders ('input', 'output') so they never become fake categories
  const folders = allFolders.filter(f => f.name !== "input" && f.name !== "output");

  // Get accurate image count for each class folder
  const classList = await Promise.all(
    folders.map(async (folder) => {
      try {
        const fileQuery = `'${folder.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
        const fileRes = await driveFetch(
          `${DRIVE_API}?q=${encodeURIComponent(fileQuery)}&pageSize=1000&fields=files(id,name,mimeType,thumbnailLink)`,
          {
            headers: {
              "Cache-Control": "no-cache"
            }
          },
          token
        );
        if (!fileRes.ok) {
          return { id: folder.id, name: folder.name, samples: 0, files: [] };
        }
        const fileData = await fileRes.json();
        const allFiles = fileData.files || [];
        
        const images = allFiles.filter(f => 
          !f.mimeType || f.mimeType.startsWith("image/") || /\.(jpg|jpeg|png|webp|bmp|gif|tiff)$/i.test(f.name)
        );

        return {
          id: folder.id,
          name: folder.name,
          samples: images.length,
          files: images
        };
      } catch (err) {
        console.warn(`Failed to list images for class ${folder.name}:`, err);
        return { id: folder.id, name: folder.name, samples: 0, files: [] };
      }
    })
  );

  return classList;
}

// 6. Create a new class category folder inside Image_Classifier/input/
export async function createClassInDrive(token, inputFolderId, className) {
  return await getOrCreateFolder(token, className, inputFolderId);
}

// 7. Delete a class category folder from Google Drive
export async function deleteClassFromDrive(token, folderId) {
  const res = await driveFetch(
    `${DRIVE_API}/${folderId}`,
    {
      method: "DELETE"
    },
    token
  );
  return res.ok;
}

// 8. Rename a class category folder in Google Drive
export async function renameClassInDrive(token, folderId, newName) {
  const res = await driveFetch(
    `${DRIVE_API}/${folderId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: newName })
    },
    token
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "Failed to rename folder in Google Drive");
  }
  return await res.json();
}

// 9. Direct Multipart Upload: streams local files directly to Google Drive (Zero local/server disk usage)
export async function uploadFileToDrive(token, targetFolderId, file) {
  const metadata = {
    name: file.name,
    parents: [targetFolderId],
    mimeType: file.type || "image/jpeg"
  };

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const fileBase64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const body =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${file.type || "image/jpeg"}\r\n` +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    fileBase64 +
    closeDelimiter;

  const res = await driveFetch(
    UPLOAD_API,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    },
    token
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "Google Drive upload failed");
  }

  return await res.json();
}
