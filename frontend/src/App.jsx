import { useState } from "react"
import { ScanLine } from "lucide-react"
import DriveConnectDialog from "./components/DriveConnectDialog"
import WelcomeScreen from "./WelcomeScreen"
import ProjectScreen from "./ProjectScreen"
import StudioScreen from "./StudioScreen"
import { useDriveConnection } from "./lib/useDriveConnection"

function readProject() {
  try {
    return JSON.parse(localStorage.getItem("active_project_config"))
  } catch {
    return null
  }
}

export default function App() {
  const [projectConfig, setProjectConfig] = useState(readProject)
  const drive = useDriveConnection(projectConfig?.mode === "drive")
  const [screen, setScreen] = useState(() => {
    const saved = localStorage.getItem("active_screen")
    if (saved === "studio" && projectConfig && (projectConfig.mode !== "drive" || drive.token)) {
      return "studio"
    }
    return "project"
  })

  function navigate(nextScreen) {
    setScreen(nextScreen)
    localStorage.setItem("active_screen", nextScreen)
  }

  function selectProject(config) {
    setProjectConfig(config)
    localStorage.setItem("active_project_config", JSON.stringify(config))
    navigate("studio")
  }

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <div className="studio-brand">
          <span className="studio-mark"><ScanLine size={20} aria-hidden="true" /></span>
          Image Classifier Studio
        </div>
        {screen !== "studio" && (
          <button type="button" onClick={() => navigate(screen === "welcome" ? "project" : "welcome")}>
            {screen === "welcome" ? "Back to projects" : "Quick guide"}
          </button>
        )}
      </header>

      <main className={`studio-main studio-main--${screen}`}>
        {screen === "welcome" && <WelcomeScreen onNext={() => navigate("project")} />}
        {screen === "project" && (
          <ProjectScreen
            onSelectProject={selectProject}
            requestDriveAccess={drive.requestAccess}
            disconnectDrive={drive.disconnect}
            googleToken={drive.token}
          />
        )}
        {screen === "studio" && (
          <StudioScreen
            googleToken={drive.token}
            requestDriveAccess={drive.requestAccess}
            projectConfig={projectConfig}
            onExit={() => navigate("project")}
          />
        )}
      </main>

      {drive.request && (
        <DriveConnectDialog
          key={drive.request.id}
          purpose={drive.request.purpose}
          onConnected={drive.connect}
          onCancel={drive.cancel}
        />
      )}
    </div>
  )
}
