// src/screens/StudioScreen.jsx
import React, { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CheckCircle2Icon, InfoIcon, AlertCircle, Upload, UploadCloud, Trash2, ArrowRight, ArrowLeft, Cloud, Pencil, Check, X, FolderPlus, Loader2, HardDrive, RotateCcw, HelpCircle, ChevronDown, ChevronUp } from "lucide-react"
import {
  findDriveWorkspace,
  findDriveWorkspaceByRootId,
  listDriveClasses,
  createClassInDrive,
  deleteClassFromDrive,
  renameClassInDrive,
  uploadFileToDrive,
} from "@/lib/googleDrive"

const API = (window.CLASSIFIER_API_URL || import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "")

export default function StudioScreen({ onExit, googleToken, requestDriveAccess, projectConfig = { mode: "new" } }) {
  const mode = projectConfig?.mode || "new"
  const folderId = projectConfig?.folderId || null
  const folderName = projectConfig?.folderName || "Image_Classifier"
  const initialProjectName = projectConfig?.projectName || projectConfig?.folderName || "Image_Classifier"
  const [projectName, setProjectName] = useState(initialProjectName)

  // Project Rename Dialog (Anti-Merge Protection)
  const [renameDialog, setRenameDialog] = useState({
    isOpen: false,
    target: "drive", // "drive" | "local"
    nameInput: "",
    error: "",
    inlineError: "",
    isChecking: false
  })

  const [step, setStep] = useState(1) // 1: Dataset -> 2: Training -> 3: Predict
  const [classes, setClasses] = useState([])
  const [className, setClassName] = useState("")
  const [isTraining, setIsTraining] = useState(false)
  const [status, setStatus] = useState("Incomplete")
  const [preview, setPreview] = useState(null)
  const [preds, setPreds] = useState({})
  const [topClass, setTopClass] = useState("")
  const [isPredicting, setIsPredicting] = useState(false)
  const [alert, setAlert] = useState(null)

  // Inline rename state for category and project
  const [editingClass, setEditingClass] = useState(null)
  const [editName, setEditName] = useState("")
  const [isEditingProjectName, setIsEditingProjectName] = useState(false)
  const [editProjectNameInput, setEditProjectNameInput] = useState("")

  // Expand/collapse class photos grid
  const [expandedClasses, setExpandedClasses] = useState({})
  const toggleClassExpand = (cName) => {
    setExpandedClasses(prev => ({ ...prev, [cName]: !prev[cName] }))
  }

  // Alert Dialog states for confirmations
  const [classToDelete, setClassToDelete] = useState(null)
  const [classToClear, setClassToClear] = useState(null)
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false)

  // Google Drive save state
  const [driveWorkspace, setDriveWorkspace] = useState(null)
  const [isDriveSyncing, setIsDriveSyncing] = useState(false)
  const [isSavingDrive, setIsSavingDrive] = useState(false)
  const [driveSaved, setDriveSaved] = useState(false)

  // Local save state
  const [isSavingLocal, setIsSavingLocal] = useState(false)
  const [localSaved, setLocalSaved] = useState(false)

  // Upload Progress Modal state
  const [uploadProgress, setUploadProgress] = useState({
    isOpen: false,
    current: 0,
    total: 0,
    progress: 0,
    currentFileName: "",
    targetClass: "",
    isCompleted: false
  })

  // Save Progress Modal state
  const [saveProgress, setSaveProgress] = useState({
    isOpen: false,
    progress: 0,
    isCompleted: false,
    target: "drive"
  })

  // Hyperparameters
  const [epochs, setEpochs] = useState(10)
  const [batchSize, setBatchSize] = useState(16)
  const [learningRate, setLearningRate] = useState(0.001)

  const handleResetHyperparameters = () => {
    setEpochs(10)
    setBatchSize(16)
    setLearningRate(0.001)
    setAlert({
      type: "info",
      title: "Options Reset",
      desc: "Advance options reset to default values (Epochs: 10, Batch: 16, LR: 0.001)."
    })
  }

  const executeSaveLocal = async (targetName) => {
    const saveName = targetName || projectName
    setIsSavingLocal(true)
    setSaveProgress({
      isOpen: true,
      progress: 25,
      isCompleted: false,
      target: "local"
    })

    const progressInterval = setInterval(() => {
      setSaveProgress((prev) => {
        if (!prev.isOpen || prev.isCompleted || prev.progress >= 90) return prev
        const increment = Math.floor(Math.random() * 15) + 10
        return { ...prev, progress: Math.min(prev.progress + increment, 90) }
      })
    }, 250)

    try {
      // 1. Commit backup to server projects folder
      const saveRes = await fetch(`${API}/save-local`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_name: saveName,
          overwrite: true
        })
      })
      const saveData = await saveRes.json()
      if (!saveRes.ok) {
        throw new Error(saveData.detail || "Failed to save project locally")
      }

      // 2. Fetch project zip containing trained model, classes.json, and dataset
      const res = await fetch(`${API}/download-project/${encodeURIComponent(saveName)}`)
      if (!res.ok) throw new Error("Failed to generate project archive")
      const blob = await res.blob()
      const fileName = `${saveName}_project.zip`

      // 3. Let user select exact save location if supported by browser (Chrome/Edge/Windows)
      if ("showSaveFilePicker" in window) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [
              {
                description: "Project ZIP Archive",
                accept: { "application/zip": [".zip"] }
              }
            ]
          })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          clearInterval(progressInterval)
          setSaveProgress({
            isOpen: true,
            progress: 100,
            isCompleted: true,
            target: "local"
          })
          setLocalSaved(true)
          setAlert({
            type: "success",
            title: "Saved Locally",
            desc: `Project package saved to your chosen location!`
          })
          return
        } catch (pickerErr) {
          if (pickerErr.name === "AbortError") {
            clearInterval(progressInterval)
            setSaveProgress((prev) => ({ ...prev, isOpen: false }))
            return
          }
          console.warn("Picker fallback to Downloads:", pickerErr)
        }
      }

      // 4. Fallback / Default: Saves directly into the user's Downloads folder!
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      clearInterval(progressInterval)
      setSaveProgress({
        isOpen: true,
        progress: 100,
        isCompleted: true,
        target: "local"
      })
      setLocalSaved(true)
      setAlert({
        type: "success",
        title: "Saved to Downloads",
        desc: `Saved "${fileName}" to your Downloads folder.`
      })
    } catch (err) {
      clearInterval(progressInterval)
      console.error("Save local error:", err)
      setSaveProgress((prev) => ({ ...prev, isOpen: false }))
      setAlert({
        type: "default",
        title: "Save Local Error",
        desc: err.message || "Failed to download project files."
      })
    } finally {
      setIsSavingLocal(false)
    }
  }

  const handleSaveLocal = async () => {
    setIsSavingLocal(true)
    executeSaveLocal(projectName)
  }

  const executeSaveDrive = async (targetName, token) => {
    const saveName = targetName || projectName
    setSaveProgress({
      isOpen: true,
      progress: 20,
      isCompleted: false,
      target: "drive"
    })
    setIsSavingDrive(true)

    const progressInterval = setInterval(() => {
      setSaveProgress((prev) => {
        if (!prev.isOpen || prev.isCompleted || prev.progress >= 90) return prev
        const increment = Math.floor(Math.random() * 10) + 8
        return { ...prev, progress: Math.min(prev.progress + increment, 90) }
      })
    }, 350)

    try {
      const res = await fetch(`${API}/save-drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_token: token,
          project_name: saveName,
          overwrite: mode === "drive" && saveName === folderName
        })
      })
      const data = await res.json()
      if (res.status === 409) {
        clearInterval(progressInterval)
        setSaveProgress((prev) => ({ ...prev, isOpen: false }))
        setRenameDialog({
          isOpen: true,
          target: "drive",
          nameInput: `${saveName}_copy`,
          error: data.detail || `A Google Drive folder named "${saveName}" already exists. Please choose a different name to avoid merging or overwriting files.`,
          inlineError: "",
          isChecking: false
        })
        return
      }
      if (!res.ok) throw new Error(data.detail || "Failed to save to Drive")

      clearInterval(progressInterval)
      setSaveProgress({
        isOpen: true,
        progress: 100,
        isCompleted: true,
        target: "drive"
      })
      setDriveSaved(true)
      setAlert({
        type: "success",
        title: `Saved to Google Drive (${saveName})`,
        desc: data.message || `Saved dataset & model to Google Drive under "${saveName}/".`
      })
    } catch (err) {
      clearInterval(progressInterval)
      console.error("Save to Drive error:", err)
      setSaveProgress((prev) => ({ ...prev, isOpen: false }))
      setAlert({
        type: "destructive",
        title: "Google Drive Save Error",
        desc: err.message || "Failed to save project files to Google Drive."
      })
    } finally {
      setIsSavingDrive(false)
    }
  }

  const handleSaveDrive = async () => {
    setIsSavingDrive(true)
    const token = await requestDriveAccess("save")
    if (!token) {
      setIsSavingDrive(false)
      return
    }

    // Pre-check for duplicate name if new project or saving under a different name
    if (mode !== "drive" || projectName.trim().toLowerCase() !== folderName.trim().toLowerCase()) {
      try {
        const chkRes = await fetch(`${API}/check-project-exists`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_name: projectName,
            target: "drive",
            google_token: token
          })
        })
        const chkData = await chkRes.json()
        if (chkData.exists) {
          setIsSavingDrive(false)
          setRenameDialog({
            isOpen: true,
            target: "drive",
            nameInput: `${projectName}_copy`,
            error: chkData.message || `A Google Drive folder named "${projectName}" already exists. Please choose a different name to avoid merging or overwriting files.`,
            inlineError: "",
            isChecking: false
          })
          return
        }
      } catch (e) {
        console.warn("Pre-save Drive check error:", e)
      }
    }

    executeSaveDrive(projectName, token)
  }

  const handleConfirmRenameAndSave = async (e) => {
    e?.preventDefault()
    const trimmed = renameDialog.nameInput.trim().replace(/\s+/g, "_")
    if (!trimmed) {
      setRenameDialog(prev => ({ ...prev, inlineError: "Please enter a valid project name." }))
      return
    }

    setRenameDialog(prev => ({ ...prev, isChecking: true, inlineError: "" }))
    const token = renameDialog.target === "drive" ? await requestDriveAccess("save") : null
    if (renameDialog.target === "drive" && !token) {
      setRenameDialog(prev => ({ ...prev, isChecking: false }))
      return
    }


    try {
      const chkRes = await fetch(`${API}/check-project-exists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_name: trimmed,
          target: renameDialog.target,
          google_token: token
        })
      })
      const chkData = await chkRes.json()
      if (chkData.exists) {
        setRenameDialog(prev => ({
          ...prev,
          isChecking: false,
          inlineError: `"${trimmed}" already exists as well. Please choose a different name to avoid merging or overwriting files.`
        }))
        return
      }
    } catch (err) {
      console.warn("Check error:", err)
    }

    const saveTarget = renameDialog.target
    setProjectName(trimmed)
    setRenameDialog({
      isOpen: false,
      target: "drive",
      nameInput: "",
      error: "",
      inlineError: "",
      isChecking: false
    })

    if (saveTarget === "drive") {
      executeSaveDrive(trimmed, token)
    } else {
      executeSaveLocal(trimmed)
    }
  }

  const handleExitToProjects = () => {
    setIsExitConfirmOpen(true)
  }

  const confirmExitToProjects = () => {
    setIsExitConfirmOpen(false)
    if (!driveSaved && !localSaved && mode !== "drive") {
      fetch(`${API}/init-project`, { method: "POST" }).catch(() => { })
    }
    onExit()
  }

  const driveWorkspaceRef = useRef(null)

  const updateDriveWorkspace = useCallback((ws) => {
    driveWorkspaceRef.current = ws
    setDriveWorkspace(ws)
  }, [])

  const loadClasses = useCallback(async (workspace = null) => {
    // 1. Fetch locally cached/downloaded classes (served via FastAPI's /input-files/)
    let localClasses = []
    try {
      const r = await fetch(`${API}/classes`)
      if (r.ok) {
        const d = await r.json()
        localClasses = d.classes || []
      }
    } catch (e) {
      console.warn("Could not fetch local classes:", e)
    }

    // 2. Google Drive mode (merge Drive metadata with local /input-files/ URLs so photos always display cleanly!)
    if (mode === "drive" && googleToken) {
      try {
        let ws = workspace || driveWorkspaceRef.current
        if (!ws) {
          if (folderId) {
            ws = await findDriveWorkspaceByRootId(googleToken, folderId)
          } else {
            ws = await findDriveWorkspace(googleToken)
          }
          if (ws) updateDriveWorkspace(ws)
        }
        if (ws && ws.inputId) {
          const driveClasses = await listDriveClasses(googleToken, ws.inputId)
          const merged = driveClasses.map((dc) => {
            const localMatch = localClasses.find((lc) => lc.name.toLowerCase() === dc.name.toLowerCase())
            if (localMatch) {
              return {
                ...dc,
                samples: localMatch.samples,
                images: localMatch.images || []
              }
            }
            return {
              ...dc,
              samples: dc.samples || dc.files?.length || 0,
              images: (dc.files || []).map((f) => f.thumbnailLink || "")
            }
          })
          const driveNames = new Set(driveClasses.map(dc => dc.name.toLowerCase()))
          const extraLocal = localClasses.filter(lc => !driveNames.has(lc.name.toLowerCase()))
          setClasses([...merged, ...extraLocal])
          return
        }
      } catch (err) {
        console.error("Drive sync error, fallback to local classes:", err)
      }
    }

    setClasses(localClasses)
  }, [mode, googleToken, folderId, updateDriveWorkspace])

  const handleSyncDrive = async () => {
    if (isDriveSyncing) return
    setIsDriveSyncing(true)
    try {
      await loadClasses()
      setAlert({
        type: "success",
        title: "Synced with Google Drive",
        desc: "Categories and photos refreshed from your Drive."
      })
    } catch (err) {
      console.error("Drive manual sync error:", err)
      setAlert({
        type: "destructive",
        title: "Sync Error",
        desc: err.message || "Failed to sync with Google Drive."
      })
    } finally {
      setIsDriveSyncing(false)
    }
  }

  // Initialize workspace according to projectConfig (guarded so it only runs once per project selection)
  const initializedKeyRef = useRef(null)
  useEffect(() => {
    const key = `${mode}_${folderId || ""}_${projectName || ""}`
    if (initializedKeyRef.current === key) return
    initializedKeyRef.current = key

    const init = async () => {
      // MODE 1: Create New Project -> Starts completely clean in temporary workspace
      if (mode === "new" || mode === "new_drive") {
        setClasses([])
        try {
          await fetch(`${API}/init-project`, { method: "POST" })
        } catch { }
        setAlert({
          type: "info",
          title: `New Project: ${projectName}`,
          desc: "Clean temporary workspace initialized. Save options will appear after prediction."
        })
        return
      }

      // MODE 2: Load Existing Model in Local -> Loads local files, temporary memory mode
      if (mode === "local") {
        fetch(`${API}/classes`)
          .then((r) => r.json())
          .then((d) => {
            setClasses(d.classes || [])
            setAlert({
              type: "success",
              title: "Local Model Loaded",
              desc: projectConfig?.loadedFileName
                ? `Successfully loaded "${projectConfig.loadedFileName}". Model is ready for training or prediction!`
                : `Loaded ${d.classes?.length || 0} classes. Ready for training or prediction.`
            })
          })
          .catch(() => { })
        return
      }

      // MODE 3: Load Existing Model from Google Drive -> Loads specific selected folder
      if (mode === "drive") {
        if (googleToken) {
          setIsDriveSyncing(true)
          try {
            let existingWs = null
            if (folderId) {
              existingWs = await findDriveWorkspaceByRootId(googleToken, folderId)
            } else {
              existingWs = await findDriveWorkspace(googleToken)
            }

            if (existingWs) {
              updateDriveWorkspace(existingWs)
              await loadClasses(existingWs)
              setAlert({
                type: "success",
                title: "Google Drive Model Loaded",
                desc: `Loaded existing dataset and model from "${folderName}".`
              })
            } else {
              setClasses([])
              setAlert({
                type: "info",
                title: "Google Drive Folder Opened",
                desc: `Folder "${folderName}" opened. Add classes to begin.`
              })
            }
          } catch (err) {
            console.error("Init Drive check failed:", err)
            setAlert({
              type: "destructive",
              title: "Drive Connection Error",
              desc: "Failed to read project from Google Drive. Please check permissions."
            })
          } finally {
            setIsDriveSyncing(false)
          }
        }
      }
    }
    init()
  }, [mode, folderId, folderName, projectName, googleToken, loadClasses, updateDriveWorkspace, projectConfig?.loadedFileName])

  // Poll training status
  useEffect(() => {
    if (!isTraining) return
    const timer = setInterval(() => {
      fetch(`${API}/train/status`)
        .then((r) => r.json())
        .then((d) => {
          if (!d.is_training) {
            setIsTraining(false)
            setStatus("Completed")
            loadClasses()
            setAlert({
              type: "success",
              title: "Training Complete!",
              desc: "Model trained in temporary memory."
            })
            clearInterval(timer)
          }
        })
        .catch(() => { })
    }, 2000)
    return () => clearInterval(timer)
  }, [isTraining, loadClasses])

  // Auto-dismiss alert after 4 seconds
  useEffect(() => {
    if (!alert) return
    const timer = setTimeout(() => setAlert(null), 4000)
    return () => clearTimeout(timer)
  }, [alert])

  const addClass = async (e) => {
    e.preventDefault()
    const targetName = className.trim()

    // Validation: Empty or "0" class check
    if (!targetName || targetName === "0") {
      setAlert({
        type: "default",
        title: "Invalid Class Name",
        desc: "Class name cannot be empty or '0'. Please enter a valid name."
      })
      return
    }

    // Validation: Duplicate check
    if (classes.some((c) => c.name.toLowerCase() === targetName.toLowerCase())) {
      setAlert({
        type: "default",
        title: "Class Already Exists",
        desc: `A category named "${targetName}" already exists.`
      })
      return
    }

    if (mode === "drive" && googleToken) {
      setIsDriveSyncing(true)
      try {
        let ws = driveWorkspace
        if (!ws && folderId) {
          ws = await findDriveWorkspaceByRootId(googleToken, folderId)
          setDriveWorkspace(ws)
        }
        if (!ws?.inputId) {
          throw new Error("The Google Drive project is missing its input folder.")
        }
        await createClassInDrive(googleToken, ws.inputId, targetName)
        setClassName("")
        await loadClasses(ws)
        setAlert({
          type: "success",
          title: "Category Created",
          desc: `"${targetName}" has been created successfully.`
        })
      } catch (err) {
        console.error(err)
        setAlert({
          type: "default",
          title: "Drive Sync Error",
          desc: err.message || "Failed to create category in Google Drive."
        })
      } finally {
        setIsDriveSyncing(false)
      }
      return
    }

    // Temporary / Local workspace: temporary local running files
    const fd = new FormData()
    fd.append("class_name", targetName)
    try {
      const response = await fetch(`${API}/classes`, { method: "POST", body: fd })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        const detail = typeof result?.detail === "string" ? result.detail : null
        setAlert({
          type: "default",
          title: "Could Not Add Category",
          desc: detail || `The classifier backend rejected the request (HTTP ${response.status}).`
        })
        return
      }
      setClassName("")
      await loadClasses()
      setAlert({
        type: "success",
        title: "Category Added",
        desc: `Added category "${result?.class_name || targetName}" to project "${projectName}".`
      })
    } catch {
      setAlert({
        type: "default",
        title: "Classifier Backend Unavailable",
        desc: "Check that the classifier backend is running on localhost:8000, then try again."
      })
    }
  }

  const uploadImages = async (targetClassName, files, input) => {
    if (!files?.length || !targetClassName) return

    const fileList = Array.from(files)
    setUploadProgress({
      isOpen: true,
      current: 0,
      total: fileList.length,
      progress: 0,
      currentFileName: fileList[0].name,
      targetClass: targetClassName,
      isCompleted: false
    })

    if (mode === "drive" && googleToken && driveWorkspace?.inputId) {
      setIsDriveSyncing(true)
      try {
        const ws = driveWorkspace
        const classObj = classes.find((c) => c.name === targetClassName)
        const targetFolderId = classObj?.id || (await createClassInDrive(googleToken, ws.inputId, targetClassName)).id

        for (let i = 0; i < fileList.length; i++) {
          const f = fileList[i]
          setUploadProgress((prev) => ({
            ...prev,
            current: i,
            currentFileName: f.name,
            progress: Math.round((i / fileList.length) * 100)
          }))

          await uploadFileToDrive(googleToken, targetFolderId, f)

          setUploadProgress((prev) => ({
            ...prev,
            current: i + 1,
            progress: Math.round(((i + 1) / fileList.length) * 100)
          }))
        }

        // Mirror uploaded images to local backend so /input-files/ has immediate access
        try {
          const fdLocal = new FormData()
          fdLocal.append("class_name", targetClassName)
          for (let f of fileList) fdLocal.append("files", f)
          await fetch(`${API}/upload`, { method: "POST", body: fdLocal })
        } catch (mErr) {
          console.warn("Local upload mirror warning:", mErr)
        }

        if (input) input.value = ""
        await loadClasses(ws)

        // Lock modal into completed state
        setUploadProgress((prev) => ({
          ...prev,
          progress: 100,
          current: fileList.length,
          isCompleted: true
        }))

      } catch (err) {
        console.error("Drive upload failed:", err)
        setUploadProgress((prev) => ({ ...prev, isOpen: false }))
        setAlert({
          type: "default",
          title: "Drive Upload Failed",
          desc: err.message || "Failed to save photos to Google Drive."
        })
      } finally {
        setIsDriveSyncing(false)
      }
      return
    }

    // Local fallback
    try {
      const fd = new FormData()
      fd.append("class_name", targetClassName)
      for (let f of fileList) fd.append("files", f)

      setUploadProgress((prev) => ({ ...prev, progress: 50 }))
      const res = await fetch(`${API}/upload`, { method: "POST", body: fd })
      if (res.ok) {
        if (input) input.value = ""
        loadClasses()
        setUploadProgress((prev) => ({
          ...prev,
          progress: 100,
          current: fileList.length,
          isCompleted: true
        }))
      } else {
        setUploadProgress((prev) => ({ ...prev, isOpen: false }))
      }
    } catch {
      setUploadProgress((prev) => ({ ...prev, isOpen: false }))
    }
  }

  const deleteClass = (cName) => {
    setClassToDelete(cName)
  }

  const executeDeleteClass = async (cName) => {
    if (!cName) return

    if (mode === "drive" && googleToken && driveWorkspace) {
      setIsDriveSyncing(true)
      try {
        const classObj = classes.find((c) => c.name === cName)
        if (classObj?.id) {
          await deleteClassFromDrive(googleToken, classObj.id)
        }

        const remaining = classes.filter((c) => c.name !== cName)

        // IF ALL CLASSES ARE DELETED, DELETE THE ROOT PROJECT FOLDER!
        if (remaining.length === 0) {
          if (driveWorkspace.rootId) {
            await deleteClassFromDrive(googleToken, driveWorkspace.rootId)
          }
          setDriveWorkspace(null)
          setClasses([])
          setAlert({
            type: "info",
            title: "Project Deleted from Drive",
            desc: `All classes removed. Deleted folder "${projectName}" from Google Drive.`
          })
          return
        }

        await loadClasses()
        setAlert({
          type: "info",
          title: "Category Deleted",
          desc: `"${cName}" has been removed.`
        })
      } catch (err) {
        console.error(err)
      } finally {
        setIsDriveSyncing(false)
      }
      return
    }

    // Local mode delete
    fetch(`${API}/classes/${encodeURIComponent(cName)}`, { method: "DELETE" }).then(() => {
      loadClasses()
      setAlert({
        type: "info",
        title: "Category Deleted",
        desc: `Deleted category "${cName}".`
      })
    })
  }

  const handleRenameClass = async (classObj) => {
    const newTarget = editName.trim().replace(/\s+/g, "_")
    if (!newTarget || newTarget === "0") {
      setAlert({
        type: "default",
        title: "Invalid Name",
        desc: "Class name cannot be empty or '0'."
      })
      return
    }
    if (newTarget.toLowerCase() === classObj.name.toLowerCase()) {
      setEditingClass(null)
      return
    }
    if (classes.some((c) => c.name.toLowerCase() === newTarget.toLowerCase())) {
      setAlert({
        type: "default",
        title: "Class Already Exists",
        desc: `A category named "${newTarget}" already exists.`
      })
      return
    }

    if (mode === "drive" && googleToken) {
      setIsDriveSyncing(true)
      try {
        await renameClassInDrive(googleToken, classObj.id, newTarget)
        setEditingClass(null)
        await loadClasses()
        setAlert({
          type: "success",
          title: "Renamed in Google Drive",
          desc: `Renamed "${classObj.name}" to "${newTarget}" in your Drive.`
        })
      } catch (err) {
        console.error(err)
        setAlert({
          type: "default",
          title: "Rename Failed",
          desc: err.message || "Failed to rename folder in Google Drive."
        })
      } finally {
        setIsDriveSyncing(false)
      }
      return
    }

    // Local mode rename
    const fd = new FormData()
    fd.append("new_name", newTarget)
    fetch(`${API}/classes/${encodeURIComponent(classObj.name)}`, { method: "PUT", body: fd })
      .then((r) => r.json())
      .then(() => {
        setEditingClass(null)
        loadClasses()
        setAlert({
          type: "success",
          title: "Class Renamed",
          desc: `Renamed "${classObj.name}" to "${newTarget}".`
        })
      })
      .catch(() => { })
  }

  const handleSaveProjectRename = async (e) => {
    e?.preventDefault()
    const trimmed = editProjectNameInput.trim().replace(/\s+/g, "_")
    if (!trimmed) {
      setAlert({
        type: "destructive",
        title: "Invalid Project Name",
        desc: "Project name cannot be empty."
      })
      return
    }

    if (trimmed === projectName) {
      setIsEditingProjectName(false)
      return
    }

    // If Drive project, also rename in Google Drive if workspace root exists
    if (mode === "drive" && googleToken && (driveWorkspace?.rootId || folderId)) {
      setIsDriveSyncing(true)
      try {
        const targetId = driveWorkspace?.rootId || folderId
        await renameClassInDrive(googleToken, targetId, trimmed)
      } catch (err) {
        console.warn("Could not rename folder directly in Drive:", err)
      } finally {
        setIsDriveSyncing(false)
      }
    }

    setProjectName(trimmed)
    setIsEditingProjectName(false)

    // Keep active_project_config in localStorage up to date
    try {
      const savedCfg = localStorage.getItem("active_project_config")
      if (savedCfg) {
        const parsed = JSON.parse(savedCfg)
        parsed.projectName = trimmed
        if (mode === "drive") parsed.folderName = trimmed
        localStorage.setItem("active_project_config", JSON.stringify(parsed))
      }
    } catch {}

    setAlert({
      type: "success",
      title: "Project Renamed",
      desc: `Project name updated to "${trimmed}".`
    })
  }

  const executeClearClass = async (cName) => {
    if (!cName) return

    // 1. Instant UI update
    setClasses(prev => prev.map(c => {
      if (c.name.toLowerCase() === cName.toLowerCase()) {
        return { ...c, samples: 0, images: [], files: [] }
      }
      return c
    }))

    // 2. Drive mode: delete files in Drive folder in background
    if (mode === "drive" && googleToken) {
      const currentClass = classes.find(c => c.name.toLowerCase() === cName.toLowerCase())
      if (currentClass?.id) {
        (async () => {
          try {
            const q = `'${currentClass.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`
            const sRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`, {
              headers: { Authorization: `Bearer ${googleToken}` }
            })
            if (sRes.ok) {
              const sData = await sRes.json()
              const filesToDelete = sData.files || []
              await Promise.allSettled(filesToDelete.map(f => deleteClassFromDrive(googleToken, f.id)))
            }
          } catch (dErr) {
            console.warn("Drive clear photos background error:", dErr)
          }
        })()
      }
    }

    // 3. Clear local backend directory for this class
    try {
      await fetch(`${API}/classes/${encodeURIComponent(cName)}/clear`, { method: "POST" })
    } catch (e) {
      console.warn("Local clear error:", e)
    }

    setAlert({
      type: "info",
      title: "Category Emptied",
      desc: `All photos removed from "${cName}".`
    })
  }

  const deleteImage = (cName, imgItem) => {
    const filename = typeof imgItem === "string" ? imgItem.split("/").pop() : imgItem?.name
    let fileId = typeof imgItem === "object" ? imgItem.id : null

    // 1. Instant UI update (0ms): photo disappears immediately from screen
    setClasses(prev => prev.map(c => {
      if (c.name.toLowerCase() === cName.toLowerCase()) {
        const nextImgs = (c.images || []).filter(item => {
          if (typeof item === "string") return item !== imgItem && !item.endsWith(`/${filename}`)
          return item?.id !== fileId && item?.name !== filename
        })
        const nextFiles = (c.files || []).filter(f => f.name !== filename && (fileId ? f.id !== fileId : true))
        return {
          ...c,
          samples: nextImgs.length,
          images: nextImgs,
          files: nextFiles
        }
      }
      return c
    }))

    // 2. Perform backend & Drive deletions in the background (non-blocking, no UI freezes)
    ;(async () => {
      // Local backend deletion
      if (filename) {
        try {
          await fetch(`${API}/classes/${encodeURIComponent(cName)}/images/${encodeURIComponent(filename)}`, {
            method: "DELETE"
          })
        } catch (lErr) {
          console.warn("Local image delete warning:", lErr)
        }
      }

      // Google Drive deletion if in Drive mode
      if (mode === "drive" && googleToken) {
        const currentClass = classes.find(c => c.name.toLowerCase() === cName.toLowerCase())
        if (!fileId && currentClass?.files) {
          const match = currentClass.files.find(f => f.name === filename || f.name?.toLowerCase() === filename?.toLowerCase())
          if (match) fileId = match.id
        }

        if (!fileId && currentClass?.id && filename) {
          try {
            const q = `'${currentClass.id}' in parents and name = '${filename}' and trashed = false`
            const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`, {
              headers: { Authorization: `Bearer ${googleToken}` }
            })
            if (searchRes.ok) {
              const sData = await searchRes.json()
              if (sData.files && sData.files.length > 0) {
                fileId = sData.files[0].id
              }
            }
          } catch (sErr) {
            console.warn("Could not find file in Drive:", sErr)
          }
        }

        if (fileId) {
          try {
            await deleteClassFromDrive(googleToken, fileId)
          } catch (err) {
            console.error("Failed to delete image from Drive:", err)
          }
        }
      }
    })()
  }

  const handleStartTraining = async () => {
    if (classes.length < 2) {
      setAlert({
        type: "destructive",
        title: "Cannot Train Model",
        desc: "At least 2 categories are required to train."
      })
      return
    }

    const empty = classes.find((c) => !c.samples || c.samples === 0)
    if (empty) {
      setAlert({
        type: "destructive",
        title: "Cannot Train Model",
        desc: `Category "${empty.name}" has 0 photos. Every category must have at least 1 photo to train.`
      })
      return
    }

    setIsTraining(true)
    setStatus("Training")
    setAlert({
      type: "info",
      title: "Training Started",
      desc: mode === "drive" && googleToken
        ? `Fetching photos from Google Drive (${projectName}) & training model (${epochs} epochs)...`
        : `Training model on local files (${epochs} epochs)...`
    })
    try {
      const res = await fetch(`${API}/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_token: mode === "drive" ? googleToken : null,
          epochs,
          batch_size: batchSize,
          learning_rate: learningRate,
          folder_name: projectName,
          folder_id: mode === "drive" ? (driveWorkspace?.rootId || folderId) : null
        })
      })
      const d = await res.json()
      if (!res.ok) {
        throw new Error(d.detail || d.message || "Failed to start training.")
      }
    } catch (err) {
      console.error("Training start error:", err)
      setIsTraining(false)
      setStatus("Incomplete")
      setAlert({
        type: "destructive",
        title: "Training Failed",
        desc: err.message || "Could not start training."
      })
    }
  }

  const handlePredict = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setIsPredicting(true)
    setPreds({})
    setTopClass("")

    const fd = new FormData()
    fd.append("file", file)
    fetch(`${API}/predict`, { method: "POST", body: fd })
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) {
          throw new Error(d.detail || "Prediction failed")
        }
        return d
      })
      .then((d) => {
        if (d && d.all_scores) {
          setPreds(d.all_scores)
          setTopClass(d.top_class)
          setAlert({
            type: "success",
            title: "Prediction Complete",
            desc: `Top Match: ${d.top_class} (${d.all_scores[d.top_class]}% confidence)`
          })
        } else if (d && d.error) {
          throw new Error(d.error)
        }
      })
      .catch((err) => {
        console.error("Prediction error:", err)
        setAlert({
          type: "default",
          title: "Prediction Error",
          desc: err.message || "Failed to classify test photo. Please ensure model is trained."
        })
      })
      .finally(() => {
        setIsPredicting(false)
        if (e.target) e.target.value = ""
      })
  }

  const emptyClasses = classes.filter((c) => !c.samples || c.samples === 0)
  const hasEmptyClass = emptyClasses.length > 0
  const canTrain = classes.length >= 2 && !hasEmptyClass

  return (
    <div className="studio-workspace w-full mx-auto shrink-0">
      <Card className="studio-workspace-card flex flex-col overflow-hidden bg-white">

        {/* Top Stepper Indicator */}
        <div className="studio-stepper flex border-b px-4 sm:px-6 py-4 justify-between items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {[{ n: 1, label: "Dataset" }, { n: 2, label: "Training" }, { n: 3, label: "Predict" }].map((s, i) => (
              <React.Fragment key={s.n}>
                {i > 0 && <span className="text-slate-300 text-xs">›</span>}
                <div aria-current={step === s.n ? "step" : undefined} className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${step === s.n
                  ? "bg-blue-600 text-white shadow-xs shadow-blue-500/20"
                  : step > s.n
                    ? "text-emerald-700 bg-emerald-50 border border-emerald-200/60"
                    : "text-slate-400"
                  }`}>
                  <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${step === s.n ? "bg-white/20" : step > s.n ? "bg-emerald-100 text-emerald-800" : "bg-slate-200/60 text-slate-500"
                    }`}>
                    {step > s.n ? <Check className="h-2.5 w-2.5 text-emerald-700" /> : s.n}
                  </span>
                  <span className={step === s.n ? "inline" : "sr-only sm:not-sr-only"}>{s.label}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={handleExitToProjects}
            className="h-7.5 px-3 text-xs font-medium rounded-lg cursor-pointer shrink-0 text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50/80 transition-all duration-150"
          >
            Exit
          </Button>
        </div>

        {/* ================= STEP 1: CLASSES ================= */}
        {step === 1 && (
          <CardContent className="flex-1 min-h-0 flex flex-col justify-between p-5 pt-4 overflow-hidden gap-2.5">
            {/* Dynamic Destination Banner */}
            {mode === "drive" && googleToken ? (
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-800 bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-200/90 shrink-0 shadow-2xs">
                {isEditingProjectName ? (
                  <form onSubmit={handleSaveProjectRename} className="flex items-center gap-1.5 flex-1 min-w-0 mr-2">
                    <Cloud className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="font-bold text-emerald-950 text-xs shrink-0">Drive:</span>
                    <input
                      type="text"
                      value={editProjectNameInput}
                      onChange={(e) => setEditProjectNameInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") setIsEditingProjectName(false) }}
                      className="h-7 px-2.5 text-xs font-bold border border-emerald-500 rounded-lg bg-white text-emerald-950 outline-none w-44 shadow-xs"
                      placeholder="Project name"
                      autoFocus
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 shrink-0 rounded-lg cursor-pointer shadow-2xs"
                      title="Save name"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 border-slate-200 text-slate-500 bg-white hover:bg-slate-100 shrink-0 rounded-lg cursor-pointer shadow-2xs"
                      onClick={() => setIsEditingProjectName(false)}
                      title="Cancel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                    <Cloud className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="truncate font-bold text-emerald-950">Drive: {projectName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditProjectNameInput(projectName)
                        setIsEditingProjectName(true)
                      }}
                      className="h-6 w-6 inline-flex items-center justify-center rounded-lg text-emerald-700 hover:text-emerald-900 hover:bg-emerald-200/60 transition-all cursor-pointer shrink-0"
                      title="Rename project"
                      aria-label="Rename project"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-100/90 text-emerald-700 px-2 py-0.5 rounded-full font-medium shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Drive Project
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 shrink-0">
                  {isDriveSyncing ? (
                    <span className="text-[11px] text-emerald-600 flex items-center gap-1 font-medium">
                      <Loader2 className="h-3 w-3 animate-spin" /> Syncing...
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={handleSyncDrive}
                      disabled={isDriveSyncing}
                      className="h-7 px-2.5 text-[11px] text-emerald-700 hover:text-emerald-900 cursor-pointer font-medium rounded-lg"
                      title="Sync and refresh file count from Google Drive"
                    >
                      Sync Now
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs font-semibold text-blue-800 bg-blue-50 px-4 py-2 rounded-xl border border-blue-200/90 shrink-0 shadow-2xs">
                {isEditingProjectName ? (
                  <form onSubmit={handleSaveProjectRename} className="flex items-center gap-1.5 flex-1 min-w-0 mr-2">
                    <FolderPlus className="h-4 w-4 text-blue-600 shrink-0" />
                    <span className="font-bold text-blue-950 text-xs shrink-0">Project:</span>
                    <input
                      type="text"
                      value={editProjectNameInput}
                      onChange={(e) => setEditProjectNameInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") setIsEditingProjectName(false) }}
                      className="h-7 px-2.5 text-xs font-bold border border-blue-500 rounded-lg bg-white text-slate-900 outline-none w-44 shadow-xs"
                      placeholder="Project name"
                      autoFocus
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 shrink-0 rounded-lg cursor-pointer shadow-2xs"
                      title="Save name"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 border-slate-200 text-slate-500 bg-white hover:bg-slate-100 shrink-0 rounded-lg cursor-pointer shadow-2xs"
                      onClick={() => setIsEditingProjectName(false)}
                      title="Cancel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                    <FolderPlus className="h-4 w-4 text-blue-600 shrink-0" />
                    <span className="truncate font-bold text-blue-950">Project: {projectName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditProjectNameInput(projectName)
                        setIsEditingProjectName(true)
                      }}
                      className="h-6 w-6 inline-flex items-center justify-center rounded-lg text-blue-600 hover:text-blue-800 hover:bg-blue-200/60 transition-all cursor-pointer shrink-0"
                      title="Rename project"
                      aria-label="Rename project"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <span className="inline-flex items-center gap-1.5 text-[10px] bg-amber-50 text-amber-800 px-2.5 py-0.5 rounded-full font-medium border border-amber-200/80 shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      Temporary (Unsaved)
                    </span>
                  </div>
                )}
                <span className="text-[11px] text-blue-600 font-medium shrink-0">
                  Step 1 of 3
                </span>
              </div>
            )}

            {/* Add Class Form */}
            <form onSubmit={addClass} className="flex gap-2 shrink-0">
              <input
                type="text"
                placeholder="New category name (e.g. Cats)"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                className="flex h-9 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all hover:border-slate-300 shadow-2xs"
              />
              <Button type="submit" variant="default" className="h-9 px-4.5 text-xs sm:text-sm font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-2xs shrink-0 cursor-pointer transition-all active:scale-[0.99]">
                Add Class
              </Button>
            </form>

            {/* Categories Container */}
            <div className="flex-1 min-h-0 flex flex-col border border-slate-200 rounded-xl bg-slate-50/40 p-2.5 overflow-hidden">
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1 pb-1 flex justify-between items-center border-b border-slate-200/80 mb-1.5 shrink-0">
                <span className="flex items-center gap-1.5">
                  <span>Categories List</span>
                  <span className="bg-slate-200/80 text-slate-700 text-[10px] px-1.5 py-0.2 rounded-md font-semibold">
                    {classes.length}
                  </span>
                </span>
                <span className="text-[10px] text-slate-500 font-medium bg-slate-200/60 px-2 py-0.5 rounded-full">
                  {classes.length > 2 ? `2 visible (+${classes.length - 2} scrollable)` : "Showing all"}
                </span>
              </div>

              {/* Scrollable container: sleek thin scrollbar, fully scrollable when content overflows */}
              <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400">
                {classes.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-7 text-center">
                    <div className="p-3 bg-slate-100 rounded-2xl mb-2.5">
                      <FolderPlus className="h-7 w-7 text-slate-400" />
                    </div>
                    <p className="text-sm font-semibold text-slate-600">No categories yet</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm leading-relaxed">
                      Type a category name above like "Cats" or "Dogs" to start building your dataset.
                    </p>
                  </div>
                )}

                {classes.map((c) => {
                  const classImages = c.images || c.files || []
                  const count = c.samples || classImages.length

                  return (
                    <div
                      key={c.name}
                      className="flex flex-col bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-2 text-xs sm:text-sm font-medium transition-all shrink-0 gap-1.5 shadow-2xs"
                    >
                      {/* Class Header: Name, Count Badge & Actions */}
                      <div className="flex justify-between items-center border-b border-slate-100 pb-1">
                        {editingClass?.name === c.name ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault()
                              handleRenameClass(c)
                            }}
                            className="flex items-center gap-1.5 flex-1 mr-1"
                          >
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="h-7 px-2.5 py-0.5 text-xs border border-primary rounded-lg bg-background w-full outline-none font-medium"
                              autoFocus
                            />
                            <Button
                              type="submit"
                              variant="outline"
                              size="icon"
                              className="h-6 w-6 border-green-300 text-green-700 hover:bg-green-50 shrink-0 rounded-lg cursor-pointer"
                              title="Save name"
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-6 w-6 text-slate-500 hover:bg-slate-100 shrink-0 rounded-lg cursor-pointer"
                              onClick={() => setEditingClass(null)}
                              title="Cancel"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </form>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 truncate">
                              <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0" />
                              <span className="font-bold text-slate-800 text-xs sm:text-sm truncate">{c.name}</span>
                              <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${count > 0
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200/80"
                                : "bg-amber-50 text-amber-700 border-amber-200/80"
                                }`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${count > 0 ? "bg-emerald-500" : "bg-amber-500"}`} />
                                {count} photos
                              </span>
                              {classImages.length > 8 && (
                                <button
                                  type="button"
                                  onClick={() => toggleClassExpand(c.name)}
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50/80 hover:bg-blue-100/80 border border-blue-200/80 px-2 py-0.5 rounded-full transition-all cursor-pointer select-none shrink-0"
                                  title={expandedClasses[c.name] ? "Collapse to single row" : `View all ${count} photos in a grid`}
                                >
                                  <span>{expandedClasses[c.name] ? "Collapse" : `View all (${count})`}</span>
                                  {expandedClasses[c.name] ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                                </button>
                              )}
                            </div>

                            <div className="flex items-center gap-0.5 shrink-0">
                              {count > 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg cursor-pointer"
                                  onClick={() => setClassToClear(c.name)}
                                  title={`Clear all photos in "${c.name}"`}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                                onClick={() => {
                                  setEditingClass(c)
                                  setEditName(c.name)
                                }}
                                title={`Rename ${c.name}`}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-slate-400 hover:text-destructive hover:bg-red-50 rounded-lg cursor-pointer"
                                onClick={() => deleteClass(c.name)}
                                title={`Delete ${c.name}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Row or Grid of Thumbnails */}
                      <div
                        onWheel={(e) => {
                          if (!expandedClasses[c.name] && e.deltaY !== 0) {
                            e.currentTarget.scrollLeft += e.deltaY * 1.5
                          }
                        }}
                        className={
                          expandedClasses[c.name]
                            ? "flex flex-wrap items-center gap-2 max-h-80 overflow-y-auto py-1 pr-1"
                            : "flex items-center gap-2 overflow-x-auto py-1 scroll-smooth"
                        }
                      >
                        {/* Box 1: The Upload Button with Drag & Drop */}
                        <label
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault()
                            if (e.dataTransfer?.files?.length) {
                              uploadImages(c.name, e.dataTransfer.files)
                            }
                          }}
                          className="flex flex-col items-center justify-center w-14 h-14 min-w-[3.5rem] rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 hover:bg-blue-100/60 hover:border-blue-400 text-blue-600 cursor-pointer transition-all shrink-0 select-none group"
                        >
                          <Upload className="h-4.5 w-4.5 stroke-[2.2] text-blue-600 group-hover:scale-110 transition-transform" />
                          <span className="text-[9px] font-semibold mt-0.5">Upload</span>
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => uploadImages(c.name, e.target.files, e.target)}
                          />
                        </label>

                        {/* Uploaded Images with Delete Icon on Hover */}
                        {classImages.map((img, idx) => {
                          const imgSrc = typeof img === "string"
                            ? (img.startsWith("http") ? img : `${API}${img}`)
                            : (img.thumbnailLink || "")

                          return (
                            <div
                              key={idx}
                              className="relative w-14 h-14 min-w-[3.5rem] rounded-xl border border-slate-200 bg-slate-100 overflow-hidden shrink-0 group shadow-2xs"
                            >
                              <img
                                src={imgSrc}
                                alt={`${c.name} sample ${idx + 1}`}
                                className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                                loading="lazy"
                              />

                              {/* Delete Button on Top-Right corner shown on hover */}
                              <button
                                type="button"
                                onClick={() => deleteImage(c.name, img)}
                                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-150 cursor-pointer shadow-md hover:scale-110"
                                title="Delete this photo"
                              >
                                <X className="h-3 w-3 stroke-[2.5]" />
                              </button>
                            </div>
                          )
                        })}

                        {/* Clean empty helper chip if no images uploaded yet */}
                        {classImages.length === 0 && (
                          <div className="flex items-center gap-2 px-3 py-1 text-xs bg-slate-50/80 border border-dashed border-slate-200 rounded-xl h-14 flex-1 max-w-xs select-none">
                            <InfoIcon className="h-4 w-4 text-slate-300 shrink-0" />
                            <div className="flex flex-col min-w-0">
                              <span className="font-medium text-slate-600 text-[11px] leading-tight">No photos yet</span>
                              <span className="text-[10px] text-slate-400 truncate">Click Upload or drop photos here</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Next Step Button & Persistent Height Status Row */}
            <div className="flex flex-col gap-1 shrink-0">
              <Button
                variant={canTrain ? "default" : "outline"}
                className={`w-full h-10 text-sm font-semibold rounded-xl cursor-pointer shrink-0 transition-all ${canTrain ? "bg-blue-600 hover:bg-blue-700 text-white shadow-xs shadow-blue-500/20" : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"}`}
                disabled={!canTrain}
                onClick={() => { setStep(2); setAlert(null); }}
              >
                <span>Next: Model Training</span> <ArrowRight className={`h-4 w-4 ml-2 ${canTrain ? "text-white/80" : "text-slate-400"}`} />
              </Button>
              <div className="h-5 flex items-center justify-center shrink-0">
                {classes.length >= 2 && hasEmptyClass ? (
                  <p className="text-[11px] text-amber-700 font-medium text-center flex items-center justify-center gap-1.5 leading-none">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span>Category "{emptyClasses[0]?.name}" has 0 photos. Upload photos before training.</span>
                  </p>
                ) : classes.length < 2 ? (
                  <p className="text-[11px] text-slate-400 text-center leading-none">
                    Add at least 2 categories with photos to proceed to training.
                  </p>
                ) : (
                  <p className="text-[11px] text-emerald-600 font-medium text-center flex items-center justify-center gap-1.5 leading-none">
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <span>All categories have photos. Ready for training!</span>
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        )}

        {/* ================= STEP 2: TRAINING ================= */}
        {step === 2 && (
          <CardContent className="flex-1 min-h-0 flex flex-col justify-between p-6 pt-5 overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col justify-center">
              <div className="max-w-[640px] mx-auto w-full flex flex-col gap-4 py-1.5">
                {/* Training Status Card */}
                <div
                  className={`flex items-center justify-between p-3.5 px-4.5 rounded-xl border transition-colors duration-200 shadow-2xs ${status === "Completed"
                    ? "bg-emerald-50/80 border-emerald-200"
                    : isTraining
                      ? "bg-blue-50/80 border-blue-200"
                      : "bg-amber-50/70 border-amber-200"
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-xl shrink-0 ${status === "Completed"
                        ? "bg-emerald-100 text-emerald-700"
                        : isTraining
                          ? "bg-blue-100 text-blue-700"
                          : "bg-amber-100 text-amber-700"
                        }`}
                    >
                      {status === "Completed" ? (
                        <CheckCircle2Icon className="h-5 w-5 shrink-0" />
                      ) : isTraining ? (
                        <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                      ) : (
                        <AlertCircle className="h-5 w-5 shrink-0" />
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Training Status
                      </span>
                      <span className="text-sm font-bold text-slate-800">
                        {status === "Completed"
                          ? "Model Ready for Prediction"
                          : isTraining
                            ? "Training in progress..."
                            : "Model Not Trained Yet"}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border shrink-0 ${status === "Completed"
                      ? "bg-emerald-100/90 text-emerald-800 border-emerald-300/80"
                      : isTraining
                        ? "bg-blue-100/90 text-blue-800 border-blue-300/80"
                        : "bg-amber-100/90 text-amber-800 border-amber-300/80"
                      }`}
                  >
                    {isTraining ? (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
                      </span>
                    ) : (
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${status === "Completed" ? "bg-emerald-600" : "bg-amber-600"
                          }`}
                      />
                    )}
                    <span>{status === "Completed" ? "Completed" : isTraining ? "Training" : "Incomplete"}</span>
                  </span>
                </div>

                {/* Advance Options Container */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/40 shadow-2xs space-y-3">
                  <div className="flex justify-between items-center border-b border-slate-200/80 pb-2">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Advance Options
                    </span>
                    <span className="text-[11px] text-slate-400 font-medium">Training hyperparameters</span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-0.5">
                    {/* Epochs Card */}
                    <div className="flex flex-col bg-white border border-slate-200 rounded-xl p-3 shadow-2xs transition-colors hover:border-slate-300">
                      <div className="flex items-center justify-between h-5 mb-2">
                        <span className="text-xs font-bold text-slate-700 leading-none">Epochs</span>
                        <div className="relative group flex items-center">
                          <HelpCircle className="h-3.5 w-3.5 text-slate-400 hover:text-blue-500 transition-colors" />
                          <div className="absolute bottom-full right-0 mb-2 w-52 bg-slate-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50">
                            Number of times the model trains over the full dataset. More epochs = longer training, potentially better accuracy. Default: 10.
                            <div className="absolute top-full right-2 border-4 border-transparent border-t-slate-800" />
                          </div>
                        </div>
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={epochs}
                        onChange={(e) => setEpochs(Number(e.target.value))}
                        className="w-full h-8.5 px-2 text-center font-bold text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:bg-white transition-colors"
                      />
                    </div>

                    {/* Batch Size Card */}
                    <div className="flex flex-col bg-white border border-slate-200 rounded-xl p-3 shadow-2xs transition-colors hover:border-slate-300">
                      <div className="flex items-center justify-between h-5 mb-2">
                        <span className="text-xs font-bold text-slate-700 leading-none">Batch Size</span>
                        <div className="relative group flex items-center">
                          <HelpCircle className="h-3.5 w-3.5 text-slate-400 hover:text-blue-500 transition-colors" />
                          <div className="absolute bottom-full right-0 mb-2 w-52 bg-slate-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50">
                            Number of images processed together per step. Smaller = slower but uses less memory. Larger = faster but needs more RAM. Default: 16.
                            <div className="absolute top-full right-2 border-4 border-transparent border-t-slate-800" />
                          </div>
                        </div>
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={128}
                        value={batchSize}
                        onChange={(e) => setBatchSize(Number(e.target.value))}
                        className="w-full h-8.5 px-2 text-center font-bold text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:bg-white transition-colors"
                      />
                    </div>

                    {/* Learning Rate Card */}
                    <div className="flex flex-col bg-white border border-slate-200 rounded-xl p-3 shadow-2xs transition-colors hover:border-slate-300">
                      <div className="flex items-center justify-between h-5 mb-2">
                        <span className="text-xs font-bold text-slate-700 leading-none">Learning Rate</span>
                        <div className="relative group flex items-center">
                          <HelpCircle className="h-3.5 w-3.5 text-slate-400 hover:text-blue-500 transition-colors" />
                          <div className="absolute bottom-full right-0 mb-2 w-56 bg-slate-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50">
                            Controls how fast the model learns. Too high = unstable training. Too low = very slow learning. Default: 0.001.
                            <div className="absolute top-full right-2 border-4 border-transparent border-t-slate-800" />
                          </div>
                        </div>
                      </div>
                      <input
                        type="number"
                        step="0.0001"
                        min={0.00001}
                        value={learningRate}
                        onChange={(e) => setLearningRate(Number(e.target.value))}
                        className="w-full h-8.5 px-2 text-center font-bold text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:bg-white transition-colors"
                      />
                    </div>
                  </div>
                </div>

                {/* Action Buttons: Train / Re-train + Reset Values */}
                <div className="flex gap-2.5 items-center shrink-0">
                  <Button
                    variant={status === "Completed" ? "outline" : "default"}
                    className={`flex-1 h-11 text-sm font-semibold rounded-xl cursor-pointer transition-colors shadow-2xs active:scale-100 ${status === "Completed"
                      ? "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                      : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20"
                      }`}
                    disabled={isTraining || !canTrain}
                    onClick={handleStartTraining}
                  >
                    {isTraining ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin shrink-0 text-white" />
                        <span>Training Model...</span>
                      </span>
                    ) : status === "Completed" ? (
                      <span>Re-train Model</span>
                    ) : (
                      <span>Start Model Training</span>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleResetHyperparameters}
                    disabled={isTraining}
                    className="h-11 px-4 text-xs font-semibold text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-100/80 rounded-xl cursor-pointer shrink-0 flex items-center gap-1.5 shadow-2xs active:scale-100"
                    title="Reset advance options to defaults (Epochs: 10, Batch: 16, LR: 0.001)"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                    <span>Reset Values</span>
                  </Button>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex gap-3 pt-3 border-t border-slate-100 shrink-0">
              <Button variant="outline" className="w-1/2 h-10 text-xs font-semibold rounded-xl cursor-pointer" onClick={() => setStep(1)}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5 text-slate-400" /> Back to Dataset
              </Button>
              <div
                className={`w-1/2 relative group ${status !== "Completed" ? "cursor-not-allowed" : ""}`}
                title={status !== "Completed" ? "Training is not completed" : ""}
              >
                <Button
                  variant={status === "Completed" ? "default" : "outline"}
                  className={`w-full h-10 text-xs font-semibold rounded-xl cursor-pointer transition-all ${status === "Completed" ? "bg-blue-600 hover:bg-blue-700 text-white shadow-xs shadow-blue-500/20" : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"}`}
                  disabled={status !== "Completed"}
                  onClick={() => {
                    if (status !== "Completed") return
                    setStep(3)
                    setAlert(null)
                  }}
                >
                  <span>Next: Predict</span> <ArrowRight className={`h-3.5 w-3.5 ml-1.5 ${status === "Completed" ? "text-white/80" : "text-slate-400"}`} />
                </Button>
                {status !== "Completed" && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-white bg-slate-900 rounded-lg shadow-lg whitespace-nowrap z-30 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
                    <AlertCircle className="h-3 w-3 text-amber-400" />
                    <span>Training is not completed</span>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        )}

        {/* ================= STEP 3: PREDICTION ================= */}
        {step === 3 && (
          <CardContent className="flex-1 min-h-0 flex flex-col justify-between p-6 pt-5 overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col justify-center overflow-y-auto pr-0.5 scrollbar-none py-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start w-full">

                {/* Left Column: Image Selector & Live Preview */}
                <div className="flex flex-col gap-3">
                  <label className="flex items-center justify-center border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-xl p-3 bg-slate-50/60 hover:bg-blue-50/30 cursor-pointer text-xs font-medium text-slate-700 hover:text-blue-600 transition-colors shrink-0">
                    <UploadCloud className="h-4 w-4 mr-2 text-primary" /> Choose Test Photo to Classify
                    <input type="file" accept="image/*" className="hidden" onChange={handlePredict} />
                  </label>

                  {preview ? (
                    <div className="h-64 w-full bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center border border-slate-200 shadow-inner shrink-0">
                      <img src={preview} alt="Test" className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : (
                    <div className="h-64 w-full bg-slate-50/80 rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 gap-2 p-4 text-center shrink-0">
                      <div className="p-3 bg-white rounded-full border border-slate-200/80 shadow-2xs">
                        <UploadCloud className="h-6 w-6 text-slate-400" />
                      </div>
                      <span className="text-xs font-medium text-slate-600">No test photo selected</span>
                      <span className="text-[11px] text-slate-400 max-w-[220px] leading-relaxed">Select an image above to run classification with your trained model</span>
                    </div>
                  )}
                </div>

                {/* Right Column: Prediction Results & Save Actions */}
                <div className="flex flex-col gap-4">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Classification Results</span>
                    {Object.keys(preds).length > 0 && (
                      <span className="text-[11px] text-slate-400 font-medium">Confidence Score</span>
                    )}
                  </div>

                  {isPredicting && (
                    <div className="flex items-center justify-center gap-2 py-10 text-xs font-semibold text-primary animate-pulse">
                      <Loader2 className="h-4 w-4 animate-spin" /> Classifying photo with model...
                    </div>
                  )}

                  {Object.keys(preds).length > 0 ? (
                    <div className="space-y-2.5">
                      {Object.entries(preds)
                        .sort(([, a], [, b]) => b - a)
                        .map(([clsName, score]) => {
                          const isTop = topClass === clsName
                          return (
                            <div
                              key={clsName}
                              className={`p-3 rounded-xl border transition-all ${isTop
                                ? "bg-emerald-50/50 border-emerald-200 shadow-2xs"
                                : "bg-white border-slate-200/80"
                                }`}
                            >
                              <div className="flex justify-between items-center font-semibold text-slate-800 text-sm">
                                <div className="flex items-center gap-2">
                                  <span>{clsName}</span>
                                  {isTop && (
                                    <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-100/90 text-emerald-800 px-2 py-0.5 rounded-full font-bold border border-emerald-200">
                                      <Check className="h-3 w-3 text-emerald-700" />
                                      Top Match
                                    </span>
                                  )}
                                </div>
                                <span className={`font-bold text-sm ${isTop ? "text-emerald-700" : "text-slate-600"}`}>
                                  {score}%
                                </span>
                              </div>
                              <Progress
                                value={score}
                                className="h-2 w-full mt-2 bg-slate-100"
                                indicatorClassName={isTop ? "bg-emerald-600" : "bg-primary"}
                              />
                            </div>
                          )
                        })}
                    </div>
                  ) : (
                    !isPredicting && (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
                        <p className="text-xs font-medium text-slate-500">Awaiting test photo</p>
                        <p className="text-[11px] text-slate-400 mt-1">Predictions will appear here once an image is chosen.</p>
                      </div>
                    )
                  )}

                  {/* SAVE OPTIONS AT THE ENDING AFTER PREDICTING THE MODEL */}
                  {Object.keys(preds).length > 0 && (
                    <div className="flex flex-col gap-2.5 pt-3 border-t border-slate-200 mt-auto shrink-0">
                      <div className="flex justify-between items-center text-xs font-bold text-slate-700 uppercase tracking-wide px-0.5">
                        {isEditingProjectName ? (
                          <form onSubmit={handleSaveProjectRename} className="flex items-center gap-1.5 flex-1 min-w-0 mr-2 lowercase font-normal">
                            <span className="text-slate-600 font-bold shrink-0 text-xs uppercase">Save Project:</span>
                            <input
                              type="text"
                              value={editProjectNameInput}
                              onChange={(e) => setEditProjectNameInput(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Escape") setIsEditingProjectName(false) }}
                              className="h-6.5 px-2 text-xs font-bold border border-blue-500 rounded bg-white text-slate-900 outline-none w-36 shadow-xs"
                              placeholder="Project name"
                              autoFocus
                            />
                            <Button
                              type="submit"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"
                              title="Save project name"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-slate-400 hover:bg-slate-100 rounded cursor-pointer"
                              onClick={() => setIsEditingProjectName(false)}
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </form>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span>Save Project ({projectName})</span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditProjectNameInput(projectName)
                                setIsEditingProjectName(true)
                              }}
                              className="h-5 w-5 inline-flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-all cursor-pointer"
                              title="Rename project"
                              aria-label="Rename project"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Button
                          variant="outline"
                          disabled={isSavingDrive}
                          onClick={handleSaveDrive}
                          className={`h-10.5 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-slate-700 hover:text-emerald-800 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer rounded-xl shadow-2xs active:scale-[0.99] transition-all ${driveSaved ? "border-emerald-300 bg-emerald-50/40 text-emerald-800" : ""}`}
                          title={`Save dataset and model to Google Drive under ${projectName}/`}
                        >
                          <Cloud className="h-4 w-4 text-emerald-600 shrink-0" />
                          <span className="truncate flex items-center gap-1.5">
                            {driveSaved ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                Drive Saved
                              </>
                            ) : isSavingDrive ? (
                              "Saving..."
                            ) : (
                              "Google Drive"
                            )}
                          </span>
                        </Button>

                        <Button
                          variant="outline"
                          disabled={isSavingLocal}
                          onClick={handleSaveLocal}
                          className={`h-10.5 border-slate-200 hover:border-purple-400 hover:bg-purple-50/40 text-slate-700 hover:text-purple-800 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer rounded-xl shadow-2xs active:scale-[0.99] transition-all ${localSaved ? "border-purple-300 bg-purple-50/40 text-purple-800" : ""}`}
                          title={`Save dataset and model to Local disk under Backend/projects/${projectName}/`}
                        >
                          <HardDrive className="h-4 w-4 text-purple-600 shrink-0" />
                          <span className="truncate flex items-center gap-1.5">
                            {localSaved ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-purple-600" />
                                Local Saved
                              </>
                            ) : isSavingLocal ? (
                              "Saving..."
                            ) : (
                              "Local Disk"
                            )}
                          </span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex gap-3 pt-3 border-t border-slate-100 shrink-0">
              <Button variant="outline" className="w-1/2 h-10 text-xs font-semibold rounded-xl cursor-pointer" onClick={() => setStep(2)}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5 text-slate-400" /> Back to Train
              </Button>
              <Button variant="outline" className="w-1/2 h-10 text-xs font-semibold rounded-xl cursor-pointer hover:border-red-200 hover:text-red-600 hover:bg-red-50/50 transition-all" onClick={handleExitToProjects}>
                Exit to Projects
              </Button>
            </div>
          </CardContent>
        )}

      </Card>

      {/* Fixed Bottom-Right Toast Alert */}
      {alert && (
        <div className="fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-2.5rem)] shadow-lg pointer-events-auto transition-opacity duration-200">
          <Alert
            variant={alert.type === "success" ? "success" : alert.type === "destructive" ? "destructive" : "default"}
            className="relative bg-white border border-slate-200 pr-9 shadow-lg"
          >
            {alert.type === "success" ? (
              <CheckCircle2Icon className="h-5 w-5 text-green-600" />
            ) : alert.type === "destructive" ? (
              <AlertCircle className="h-5 w-5 text-red-600" />
            ) : (
              <InfoIcon className="h-5 w-5 text-blue-600" />
            )}
            <AlertTitle className="text-sm font-bold">{alert.title}</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground mt-0.5">{alert.desc}</AlertDescription>
            <Button
              variant="outline"
              size="icon"
              aria-label="Close notification"
              onClick={() => setAlert(null)}
              className="absolute top-2.5 right-2.5 h-6 w-6 text-slate-400 hover:text-slate-700 p-0 border-none shadow-none cursor-pointer flex items-center justify-center"
              title="Close notification"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </Alert>
        </div>
      )}

      {/* Upload Progress Modal Popup (Screen Locked) */}
      {uploadProgress.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm select-none p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-[400px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-7 flex flex-col items-center text-center">

            {!uploadProgress.isCompleted ? (
              <>
                <div className="p-4 bg-primary/10 rounded-2xl mb-4">
                  <UploadCloud className="h-10 w-10 text-primary animate-pulse" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Uploading...</h3>

                {/* Progress Bar Container */}
                <Progress
                  value={uploadProgress.progress}
                  className="w-full h-3 mt-6 bg-slate-100 border border-slate-200"
                  indicatorClassName="bg-primary"
                />

                <div className="flex justify-between w-full text-xs font-semibold text-slate-500 mt-2.5 px-1">
                  <span>{uploadProgress.current} of {uploadProgress.total} uploaded</span>
                  <span className="text-primary font-bold">{uploadProgress.progress}%</span>
                </div>
              </>
            ) : (
              <>
                <div className="p-4 bg-green-100 text-green-600 rounded-2xl mb-4">
                  <CheckCircle2Icon className="h-10 w-10" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Upload Complete!</h3>

                {/* 100% Green Progress Bar */}
                <Progress
                  value={100}
                  className="w-full h-3 mt-6 bg-green-100 border border-green-200/60"
                  indicatorClassName="bg-green-600"
                />

                <div className="flex justify-between w-full text-xs font-semibold text-green-700 mt-2 px-1">
                  <span>{uploadProgress.total} / {uploadProgress.total} photos</span>
                  <span>100% Complete</span>
                </div>

                {/* Done Button to dismiss and re-sync */}
                <Button
                  className="w-full h-11 text-sm font-semibold mt-6 shadow-sm cursor-pointer"
                  onClick={() => {
                    setUploadProgress((prev) => ({ ...prev, isOpen: false }))
                    loadClasses()
                  }}
                >
                  Done
                </Button>
              </>
            )}

          </div>
        </div>
      )}

      {/* Save Project Progress Modal Popup */}
      {saveProgress.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm select-none p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-[400px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-7 flex flex-col items-center text-center">

            {!saveProgress.isCompleted ? (
              <>
                <div className="p-4 bg-primary/10 rounded-2xl mb-4">
                  {saveProgress.target === "drive" ? (
                    <Cloud className="h-10 w-10 text-primary animate-pulse" />
                  ) : (
                    <HardDrive className="h-10 w-10 text-purple-600 animate-pulse" />
                  )}
                </div>
                <h3 className="text-xl font-bold text-slate-900">
                  {saveProgress.target === "drive" ? "Saving to Google Drive..." : "Saving to Local Disk..."}
                </h3>

                {/* Progress Bar Container */}
                <Progress
                  value={saveProgress.progress}
                  className="w-full h-3 mt-6 bg-slate-100 border border-slate-200"
                  indicatorClassName={saveProgress.target === "drive" ? "bg-primary" : "bg-purple-600"}
                />

                <div className="flex justify-between w-full text-xs font-semibold text-slate-500 mt-2.5 px-1">
                  <span>Saving project files...</span>
                  <span className="text-primary font-bold">{saveProgress.progress}%</span>
                </div>
              </>
            ) : (
              <>
                <div className="p-4 bg-green-100 text-green-600 rounded-2xl mb-4">
                  <CheckCircle2Icon className="h-10 w-10" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">
                  {saveProgress.target === "drive" ? "Saved to Google Drive!" : "Saved to Local Disk!"}
                </h3>

                {/* 100% Green Progress Bar */}
                <Progress
                  value={100}
                  className="w-full h-3 mt-6 bg-green-100 border border-green-200/60"
                  indicatorClassName="bg-green-600"
                />

                <div className="flex justify-between w-full text-xs font-semibold text-green-700 mt-2 px-1">
                  <span>Saved</span>
                  <span>100% Complete</span>
                </div>

                {/* Done Button to dismiss */}
                <Button
                  className="w-full h-11 text-sm font-semibold mt-6 shadow-sm cursor-pointer"
                  onClick={() => {
                    setSaveProgress((prev) => ({ ...prev, isOpen: false }))
                  }}
                >
                  Done
                </Button>
              </>
            )}

          </div>
        </div>
      )}

      {/* Project Rename Dialog (Anti-Merge Protection) */}
      {renameDialog.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-2xl border border-red-200 rounded-2xl bg-white overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 pb-3 border-b border-slate-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-bold text-slate-900">
                  Google Drive Folder Already Exists
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Choose a different name to avoid merging or overwriting files in Google Drive
                </p>
              </div>
            </div>
            <form onSubmit={handleConfirmRenameAndSave}>
              <div className="p-5 space-y-3">
                <div className="p-3 bg-red-50/90 border border-red-200 rounded-xl text-xs text-red-600 flex items-start gap-2.5 leading-relaxed font-medium">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <span>{renameDialog.error}</span>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    New Project Name
                  </label>
                  <input
                    type="text"
                    value={renameDialog.nameInput}
                    onChange={(e) => setRenameDialog(prev => ({ ...prev, nameInput: e.target.value, inlineError: "" }))}
                    placeholder="e.g. My_Project_v2"
                    className="h-10 w-full px-3 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    autoFocus
                  />
                  {renameDialog.inlineError && (
                    <p className="text-[11px] text-destructive font-medium">{renameDialog.inlineError}</p>
                  )}
                </div>
              </div>
              <div className="p-4 bg-slate-50/70 border-t border-slate-100 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs h-9 px-4 cursor-pointer"
                  onClick={() => setRenameDialog(prev => ({ ...prev, isOpen: false }))}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={renameDialog.isChecking}
                  className="rounded-xl text-xs font-semibold h-9 px-5 bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-xs shadow-blue-600/20"
                >
                  {renameDialog.isChecking ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Checking...
                    </>
                  ) : (
                    "Save with New Name"
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Alert Dialog: Confirm Delete Category with Yes/No */}
      <AlertDialog open={!!classToDelete} onOpenChange={(open) => !open && setClassToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the <span className="font-semibold text-slate-800">"{classToDelete}"</span> category and all its photos? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setClassToDelete(null)}>No</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = classToDelete
                setClassToDelete(null)
                executeDeleteClass(target)
              }}
            >
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Alert Dialog: Confirm Clear Category Photos */}
      <AlertDialog open={!!classToClear} onOpenChange={(open) => !open && setClassToClear(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Photos?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove all photos from <span className="font-semibold text-slate-800">"{classToClear}"</span>? The category itself will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setClassToClear(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                const target = classToClear
                setClassToClear(null)
                executeClearClass(target)
              }}
            >
              Clear Photos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Alert Dialog: Confirm Exit with Yes/No */}
      <AlertDialog open={isExitConfirmOpen} onOpenChange={setIsExitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exit Project?</AlertDialogTitle>
            <AlertDialogDescription>
              {!driveSaved && !localSaved && mode !== "drive" && classes.length > 0 ? (
                <>
                  You have unsaved changes in <span className="font-semibold text-slate-800">{projectName}</span>. Exiting will discard your temporary workspace. Do you want to proceed?
                </>
              ) : (
                <>
                  Are you sure you want to exit <span className="font-semibold text-slate-800">{projectName}</span> and return to the projects menu?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsExitConfirmOpen(false)}>No</AlertDialogCancel>
            <AlertDialogAction onClick={confirmExitToProjects}>
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
