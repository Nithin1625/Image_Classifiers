// src/screens/ProjectScreen.jsx
import React, { useState, useRef } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { FolderPlus, Cpu, UploadCloud, Folder, File, FileCode, Loader2, X, AlertCircle, ChevronRight, ArrowLeft, Search, Sparkles, RotateCw, CheckCircle2Icon } from "lucide-react"
import { listDriveFolderContents, searchAllDriveFiles } from "@/lib/googleDrive"

const API = (window.CLASSIFIER_API_URL || import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "")

export default function ProjectScreen({ onSelectProject, googleToken, requestDriveAccess, disconnectDrive }) {
  const [isDrivePickerOpen, setIsDrivePickerOpen] = useState(false)
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [nameError, setNameError] = useState("")
  const [allItems, setAllItems] = useState([])
  const [currentFolder, setCurrentFolder] = useState({ id: null, name: "My Drive" })
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: null, name: "My Drive" }])
  const [isLoading, setIsLoading] = useState(false)
  const [pickerError, setPickerError] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState("browse") // 'browse' | 'models_only'

  // Progress Bar & "Done" Button Modal state for both Drive and Local loading
  const [loadProgressModal, setLoadProgressModal] = useState({
    isOpen: false,
    mode: "drive",
    title: "",
    subtitle: "",
    progress: 0,
    isCompleted: false,
    stats: { photos: 0, classes: 0, modelLoaded: false },
    error: null,
    onDone: null
  })

  // Local model Windows file picker state
  const localFileInputRef = useRef(null)
  const [isLoadingLocalModel, setIsLoadingLocalModel] = useState(false)

  const handleOpenLocalModelPicker = async () => {
    if ("showOpenFilePicker" in window) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [
            {
              description: "Saved Models and Projects (*.keras, *.h5, *.zip)",
              accept: {
                "application/octet-stream": [".keras", ".h5"],
                "application/zip": [".zip"]
              }
            }
          ],
          multiple: false
        })
        const file = await handle.getFile()
        await uploadAndLoadModel(file)
        return
      } catch (err) {
        if (err.name === "AbortError") return
        console.warn("showOpenFilePicker error, falling back to input:", err)
      }
    }
    if (localFileInputRef.current) {
      localFileInputRef.current.value = ""
      localFileInputRef.current.click()
    }
  }

  const uploadAndLoadModel = (file) => {
    if (!file) return
    setIsLoadingLocalModel(true)

    setLoadProgressModal({
      isOpen: true,
      mode: "local",
      title: "Loading Local Project",
      subtitle: `Uploading "${file.name}"...`,
      progress: 0,
      isCompleted: false,
      stats: { photos: 0, classes: 0, modelLoaded: false },
      error: null,
      onDone: null
    })

    const formData = new FormData()
    formData.append("file", file)

    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${API}/load-local-model`)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const pct = Math.min(Math.round((event.loaded / event.total) * 85), 85)
        setLoadProgressModal(prev => ({
          ...prev,
          progress: pct,
          subtitle: `Uploading "${file.name}" (${pct}%)...`
        }))
      }
    }

    xhr.onload = () => {
      setIsLoadingLocalModel(false)
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText)
          setLoadProgressModal(prev => ({
            ...prev,
            progress: 100,
            isCompleted: true,
            subtitle: "",
            stats: {
              photos: 0,
              classes: data.classes_count || 0,
              modelLoaded: !!data.model_loaded
            },
            onDone: () => {
              setLoadProgressModal(p => ({ ...p, isOpen: false }))
              onSelectProject({
                mode: "local",
                projectName: data.project_name || "Imported_Model",
                hasLoadedModel: true,
                loadedFileName: file.name
              })
            }
          }))
        } catch (_) {
          setLoadProgressModal(prev => ({
            ...prev,
            error: "Failed to parse server response."
          }))
        }
      } else {
        let errorMsg = "Failed to load the selected file."
        try {
          const errData = JSON.parse(xhr.responseText)
          if (errData.detail) errorMsg = errData.detail
        } catch (_) {}
        setLoadProgressModal(prev => ({
          ...prev,
          error: errorMsg
        }))
      }
    }

    xhr.onerror = () => {
      setIsLoadingLocalModel(false)
      setLoadProgressModal(prev => ({
        ...prev,
        error: "Unable to connect to backend server. Please ensure it is running."
      }))
    }

    xhr.send(formData)
  }

  const handleLocalFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      uploadAndLoadModel(file)
    }
  }

  const handleCreateNewProject = (e) => {
    e?.preventDefault()
    const trimmed = newProjectName.trim().replace(/\s+/g, "_")
    if (!trimmed) {
      setNameError("Please enter a valid project name.")
      return
    }

    setIsNewProjectDialogOpen(false)
    onSelectProject({
      mode: "new",
      projectName: trimmed
    })
  }

  // Fetch items for the active folder or search
  const fetchDriveContents = async (folderId = null, tab = activeTab, token = googleToken) => {
    setIsLoading(true)
    setPickerError(null)
    setSelectedItem(null)

    if (!token) {
      setPickerError("Please sign in with Google to browse Drive files.")
      setIsLoading(false)
      return
    }

    try {
      if (tab === "models_only") {
        const results = await searchAllDriveFiles(token)
        const models = results.filter(f =>
          (f.name.toLowerCase().endsWith(".keras") ||
            f.name.toLowerCase().endsWith(".h5") ||
            f.name.toLowerCase().endsWith(".tflite")) &&
          f.mimeType !== "application/vnd.google-apps.folder"
        )
        setAllItems(models)
        if (models.length === 0) {
          setPickerError("No trained models found in your Google Drive yet. Create a new project to train one!")
        }
      } else {
        const items = await listDriveFolderContents(token, folderId)
        // Ensure all folders and files are visible, excluding only internal project directories
        const visibleItems = items.filter(i => i.name !== "input" && i.name !== "output")
        setAllItems(visibleItems)

        if (visibleItems.length === 0) {
          setPickerError("No folders or files found in this directory.")
        }
      }
    } catch (err) {
      console.error(err)
      setPickerError("Failed to read items from Google Drive. Please check permissions.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenDrivePicker = async ({ reconnect = false } = {}) => {
    const token = await requestDriveAccess("browse", { reconnect })
    if (!token) return
    setIsDrivePickerOpen(true)
    setCurrentFolder({ id: null, name: "My Drive" })
    setBreadcrumbs([{ id: null, name: "My Drive" }])
    setActiveTab("browse")
    setSearchQuery("")
    fetchDriveContents(null, "browse", token)
  }

  const handleEnterFolder = (folder) => {
    const nextBreadcrumbs = [...breadcrumbs, { id: folder.id, name: folder.name }]
    setBreadcrumbs(nextBreadcrumbs)
    setCurrentFolder(folder)
    setSearchQuery("")
    fetchDriveContents(folder.id)
  }

  const handleBreadcrumbClick = (crumb, index) => {
    const nextBreadcrumbs = breadcrumbs.slice(0, index + 1)
    setBreadcrumbs(nextBreadcrumbs)
    setCurrentFolder({ id: crumb.id, name: crumb.name })
    setSearchQuery("")
    fetchDriveContents(crumb.id)
  }

  const handleGoBack = () => {
    if (breadcrumbs.length <= 1) return
    const nextBreadcrumbs = breadcrumbs.slice(0, -1)
    const prev = nextBreadcrumbs[nextBreadcrumbs.length - 1]
    setBreadcrumbs(nextBreadcrumbs)
    setCurrentFolder({ id: prev.id, name: prev.name })
    setSearchQuery("")
    fetchDriveContents(prev.id)
  }

  const handleConfirmSelection = async (itemToLoad) => {
    const target = itemToLoad || selectedItem
    if (!target) return
    setIsDrivePickerOpen(false)

    const isFolder = target.mimeType === "application/vnd.google-apps.folder" || target.id === currentFolder.id
    const folderId = isFolder ? target.id : (target.parents?.[0] || null)
    const fileId = isFolder ? null : target.id

    setLoadProgressModal({
      isOpen: true,
      mode: "drive",
      title: "Downloading Project from Google Drive",
      subtitle: "Connecting to Google Drive...",
      progress: 5,
      isCompleted: false,
      stats: { photos: 0, classes: 0, modelLoaded: false },
      error: null,
      onDone: null
    })

    try {
      const res = await fetch(`${API}/load-drive-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_token: googleToken,
          folder_id: folderId,
          folder_name: target.name,
          file_id: fileId
        })
      })

      if (!res.ok) {
        let errText = `Server error (${res.status})`
        try {
          const errJson = await res.json()
          if (errJson.detail) errText = errJson.detail
        } catch (_) {}
        throw new Error(errText)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder("utf-8")
      let buffer = ""
      let completedData = null

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop()

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const ev = JSON.parse(trimmed)
            if (ev.type === "error") {
              throw new Error(ev.detail || "Failed to download project from Google Drive.")
            } else if (ev.type === "progress") {
              setLoadProgressModal(prev => ({
                ...prev,
                progress: typeof ev.progress === "number" ? ev.progress : prev.progress,
                subtitle: ev.message || prev.subtitle
              }))
            } else if (ev.type === "complete") {
              completedData = ev
              setLoadProgressModal(prev => ({
                ...prev,
                progress: 100,
                isCompleted: true,
                subtitle: "",
                stats: {
                  photos: ev.total_photos || 0,
                  classes: ev.classes_count || 0,
                  modelLoaded: !!ev.model_loaded
                },
                onDone: () => {
                  setLoadProgressModal(p => ({ ...p, isOpen: false }))
                  onSelectProject({
                    mode: "drive",
                    folderId: ev.folder_id || folderId,
                    folderName: ev.project_name || target.name,
                    projectName: ev.project_name || target.name,
                    fileId: fileId,
                    hasLoadedModel: ev.model_loaded
                  })
                }
              }))
            }
          } catch (itemErr) {
            if (itemErr.message && !itemErr.message.includes("JSON")) {
              throw itemErr
            }
          }
        }
      }

      if (!completedData) {
        throw new Error("Download stream ended unexpectedly.")
      }
    } catch (err) {
      console.error("Failed to load Drive project:", err)
      setLoadProgressModal(prev => ({
        ...prev,
        error: err.message || "Failed to download project from Google Drive."
      }))
    }
  }

  // Filter items by search query
  const filteredItems = allItems.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const folders = filteredItems.filter(i => i.mimeType === "application/vnd.google-apps.folder")
  const files = filteredItems.filter(i => i.mimeType !== "application/vnd.google-apps.folder")

  return (
    <section className="project-launcher" aria-labelledby="project-heading">
      <div className="project-heading">
        <h1 id="project-heading">Your model workspace</h1>
        <p>Train a new image classifier or pick up from a saved project.</p>
      </div>

      <div className="project-options">
        <article className="project-option project-option--primary">
          <span className="project-icon"><FolderPlus aria-hidden="true" /></span>
          <h2>New project</h2>
          <p>Add labeled images, train a classifier, and test its predictions.</p>
          <Dialog open={isNewProjectDialogOpen} onOpenChange={setIsNewProjectDialogOpen}>
            <DialogTrigger asChild>
              <Button className="project-action">Create project</Button>
            </DialogTrigger>
    <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3.5 pr-6">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100/80 flex items-center justify-center text-blue-600 shadow-2xs shrink-0 mt-0.5">
              <FolderPlus className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900">New Project Name</DialogTitle>
              <DialogDescription className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Enter a name for your project. This will be used when saving.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form onSubmit={handleCreateNewProject} className="space-y-4 pt-1">
          <FieldGroup className="my-0">
            <Field>
              <Label htmlFor="projectName" className="text-xs font-semibold text-slate-700">
                Project Name
              </Label>
              <Input
                id="projectName"
                placeholder="e.g. Cat_Dog_Classifier"
                value={newProjectName}
                onChange={(e) => {
                  setNewProjectName(e.target.value)
                  if (nameError) setNameError("")
                }}
                autoFocus
              />
              {nameError && (
                <div className="flex items-center gap-1.5 text-xs text-destructive font-medium mt-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{nameError}</span>
                </div>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-9.5 px-4 rounded-xl text-slate-600 hover:bg-slate-100 border-slate-200">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="default" className="h-9.5 px-5 rounded-xl font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-xs shadow-blue-500/20 cursor-pointer">
              Start Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
          </Dialog>
        </article>

        <article className="project-option">
          <span className="project-icon"><Cpu aria-hidden="true" /></span>
          <h2>From your computer</h2>
          <p>Open a saved model or project archive in .keras, .h5, or .zip format.</p>
          <Button variant="outline" className="project-action"
            onClick={handleOpenLocalModelPicker} disabled={isLoadingLocalModel}>
            {isLoadingLocalModel && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {isLoadingLocalModel ? "Loading…" : "Browse files"}
          </Button>
        </article>

        <article className="project-option">
          <span className="project-icon"><UploadCloud aria-hidden="true" /></span>
          <h2>From Google Drive</h2>
          <p>Browse Drive for a model or project folder.</p>
          <Button variant="outline" className="project-action"
            onClick={() => handleOpenDrivePicker()}>
            Browse Google Drive
          </Button>
        </article>
      </div>

      {/* Hidden File Input for local file selection fallback */}
      <input
        type="file"
        ref={localFileInputRef}
        accept=".keras,.h5,.zip"
        onChange={handleLocalFileChange}
        className="hidden"
      />

      {/* Google Drive File Explorer Modal */}
      {isDrivePickerOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl max-h-[85vh] flex flex-col shadow-lg border border-slate-200 rounded-xl bg-white overflow-hidden">
            <CardHeader className="border-b border-slate-100 p-4 pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2 text-slate-900">
                  <UploadCloud className="h-4 w-4 text-emerald-600" /> Google Drive Explorer
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Select a saved model (.keras) or project folder
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => fetchDriveContents(currentFolder.id)}
                  title="Refresh Google Drive contents"
                  className="h-7 w-7 rounded-md cursor-pointer"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsDrivePickerOpen(false)}
                  className="h-7 w-7 rounded-md cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>

            {/* Search and Filter bar */}
            <div className="p-3 border-b border-slate-100 bg-slate-50/60 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search files or folders..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 w-full pl-9 pr-3 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-slate-400 shadow-2xs"
                  />
                </div>
                <div className="flex border border-slate-200 rounded-xl bg-white p-0.5 text-xs shrink-0 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => { setActiveTab("browse"); fetchDriveContents(currentFolder.id, "browse"); }}
                    className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${activeTab === "browse" ? "bg-slate-900 text-white shadow-2xs" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    Folders
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab("models_only"); fetchDriveContents(null, "models_only"); }}
                    className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-colors flex items-center gap-1.5 ${activeTab === "models_only" ? "bg-slate-900 text-white shadow-2xs" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    <Sparkles className="h-3 w-3" /> All Models
                  </button>
                </div>
              </div>

              {/* Breadcrumbs Navigation & Counts */}
              {activeTab === "browse" && (
                <div className="flex items-center justify-between text-xs text-slate-500 overflow-x-auto py-0.5">
                  <div className="flex items-center gap-1">
                    {breadcrumbs.length > 1 && (
                      <button
                        type="button"
                        onClick={handleGoBack}
                        className="p-1 hover:bg-slate-200 rounded text-slate-500 mr-1 cursor-pointer"
                        title="Go back"
                      >
                        <ArrowLeft className="h-3 w-3" />
                      </button>
                    )}
                    {breadcrumbs.map((crumb, idx) => (
                      <React.Fragment key={crumb.id || "root"}>
                        {idx > 0 && <ChevronRight className="h-3 w-3 text-slate-400 shrink-0" />}
                        <button
                          type="button"
                          onClick={() => handleBreadcrumbClick(crumb, idx)}
                          className={`hover:underline shrink-0 cursor-pointer ${idx === breadcrumbs.length - 1 ? "font-semibold text-slate-900" : "text-slate-500"
                            }`}
                        >
                          {crumb.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                  {!isLoading && (
                    <span className="text-[11px] text-slate-400 shrink-0 ml-2">
                      {folders.length} folder{folders.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Folder & File List */}
            <CardContent className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[340px]">
              {isLoading && (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-xs">Loading contents...</span>
                </div>
              )}

              {pickerError && !isLoading && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <span>{pickerError}</span>
                </div>
              )}

              {!isLoading && !pickerError && (
                <div className="space-y-1.5">
                  {/* FOLDERS LIST */}
                  {folders.map((f) => {
                    const isSelected = selectedItem?.id === f.id
                    const isDefault = f.name === "Image_Classifier"
                    return (
                      <div
                        key={f.id}
                        className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${isSelected ? "border-primary bg-blue-50/50" : "bg-white hover:bg-slate-50 border-slate-200"
                          }`}
                      >
                        <div
                          className="flex items-center gap-2.5 flex-1 overflow-hidden cursor-pointer"
                          onClick={() => handleEnterFolder(f)}
                          title="Click to open folder"
                        >
                          <div className="p-2 rounded-md bg-slate-100 text-slate-600 shrink-0">
                            <Folder className="h-4 w-4" />
                          </div>
                          <div className="overflow-hidden">
                            <div className="font-medium text-xs text-slate-800 truncate flex items-center gap-1.5">
                              {f.name}
                              {isDefault && (
                                <span className="text-[9px] font-medium bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded">
                                  Default
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400">Click to browse inside</div>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px] font-medium shrink-0 cursor-pointer"
                          onClick={() => handleConfirmSelection(f)}
                        >
                          Select Folder
                        </Button>
                      </div>
                    )
                  })}

                  {/* FILES LIST */}
                  {files.map((file) => {
                    const isSelected = selectedItem?.id === file.id
                    const isModel = file.name.endsWith(".keras") || file.name.endsWith(".h5") || file.name.endsWith(".tflite")
                    const isJson = file.name.endsWith(".json")

                    return (
                      <div
                        key={file.id}
                        onClick={() => setSelectedItem(file)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-all cursor-pointer ${isSelected
                          ? "border-primary bg-blue-50/50"
                          : "bg-white hover:bg-slate-50 border-slate-200"
                          }`}
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <div className={`p-2 rounded-md shrink-0 ${isModel ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-600"}`}>
                            {isModel ? <FileCode className="h-4 w-4" /> : <File className="h-4 w-4" />}
                          </div>
                          <div className="overflow-hidden">
                            <div className="font-medium text-xs text-slate-800 truncate flex items-center gap-1.5">
                              {file.name}
                              {isModel && (
                                <span className="text-[9px] font-medium bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded border border-emerald-200">
                                  Model
                                </span>
                              )}
                              {isJson && (
                                <span className="text-[9px] font-medium bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded">
                                  Labels
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {file.size ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : "File"} • Modified {new Date(file.modifiedTime).toLocaleDateString()}
                            </div>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px] font-medium shrink-0 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleConfirmSelection(file)
                          }}
                        >
                          Load Model
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>

            {/* Modal Footer with Selection Actions */}
            <CardFooter className="border-t border-slate-100 p-3 bg-slate-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div className="text-xs text-slate-500 truncate max-w-full sm:max-w-[340px]">
                {currentFolder.id ? (
                  <span>Folder: <strong>{currentFolder.name}</strong></span>
                ) : (
                  <span>Pick a saved model or folder</span>
                )}
                {googleToken && (
                  <div className="mt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsDrivePickerOpen(false)
                        disconnectDrive()
                      }}
                      className="text-[10px] text-slate-400 hover:text-slate-700 hover:underline cursor-pointer"
                    >
                      Disconnect Google Drive
                    </button>
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0 self-end sm:self-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setIsDrivePickerOpen(false)}
                >
                  Cancel
                </Button>
                {currentFolder.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                    onClick={() => handleConfirmSelection(currentFolder)}
                  >
                    Select Current Folder
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* Loading & Extraction Progress Modal with Done Button */}
      {loadProgressModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-2xl border border-slate-200 rounded-2xl bg-white overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="p-5 pb-3 border-b border-slate-100 flex flex-row items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-2xs ${
                loadProgressModal.isCompleted
                  ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                  : loadProgressModal.error
                    ? "bg-red-50 text-red-600 border border-red-200"
                    : loadProgressModal.mode === "drive"
                      ? "bg-indigo-50 text-indigo-600 border border-indigo-200"
                      : "bg-emerald-50 text-emerald-600 border border-emerald-200"
              }`}>
                {loadProgressModal.isCompleted ? (
                  <CheckCircle2Icon className="h-5 w-5" />
                ) : loadProgressModal.error ? (
                  <AlertCircle className="h-5 w-5" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base font-bold text-slate-900 truncate">
                  {loadProgressModal.title}
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 mt-0.5 truncate">
                  {loadProgressModal.isCompleted ? "Download & extraction complete" : "Please wait while files are processed"}
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="p-5 space-y-4">
              {/* Progress Bar & Percentage */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-600 truncate max-w-[280px]">
                    {loadProgressModal.isCompleted
                      ? "Completed"
                      : loadProgressModal.error
                        ? "Failed"
                        : (loadProgressModal.subtitle || "Downloading files...")}
                  </span>
                  <span className={loadProgressModal.isCompleted ? "text-emerald-600 font-bold" : "text-slate-900"}>
                    {loadProgressModal.progress}%
                  </span>
                </div>
                <Progress
                  value={loadProgressModal.progress}
                  className="h-2.5 bg-slate-100 rounded-full"
                  indicatorClassName={
                    loadProgressModal.isCompleted
                      ? "bg-emerald-600"
                      : loadProgressModal.error
                        ? "bg-red-500"
                        : "bg-blue-600"
                  }
                />
              </div>

              {/* Error Alert */}
              {loadProgressModal.error && (
                <p className="text-xs text-red-600 leading-relaxed bg-red-50 p-3 rounded-xl border border-red-200">
                  {loadProgressModal.error}
                </p>
              )}

            </CardContent>

            <CardFooter className="p-4 bg-slate-50/70 border-t border-slate-100 flex justify-end gap-2">
              {loadProgressModal.error ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs h-9 px-4 cursor-pointer"
                  onClick={() => setLoadProgressModal(p => ({ ...p, isOpen: false }))}
                >
                  Close
                </Button>
              ) : loadProgressModal.isCompleted ? (
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-xl text-xs font-semibold h-9 px-6 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs shadow-emerald-600/20 cursor-pointer flex items-center justify-center"
                  onClick={loadProgressModal.onDone}
                >
                  Done
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  className="rounded-xl text-xs h-9 px-4 opacity-50 cursor-not-allowed text-slate-400"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Downloading...
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      )}

    </section>
  )
}
