# Image Classifier Studio

A simple, friendly web app for creating, training, and testing your own image recognition models right in your browser. You don't need any machine learning background or Python skills to use it.

The app opens directly to the project chooser. Create projects and open local files without an account. Google sign-in is offered when you browse Google Drive or save a project to Drive.

---

## What does this do?

Training a custom computer vision model usually means writing boilerplate Python code: setting up virtual environments, organizing folders, resizing images, defining training loops in TensorFlow or PyTorch, and writing scripts just to test a single image.

**Image Classifier Studio** simplifies that entire process into 3 visual steps:

1. **Build Your Dataset** — Create category cards (e.g. *Cats* vs *Dogs*), drag and drop photos into them, or capture photos with your webcam.
2. **Train the Model** — Click "Start Training" to train a pre-trained MobileNetV2 neural network. It runs right on your CPU in 10 to 30 seconds.
3. **Test & Save** — Drop in any photo to see real-time prediction confidence scores, then download your model as a `.zip` or save it straight to your Google Drive.

---

## Cool Features You'll Like

- **Safe Google Drive Downloads**: When loading a project from Drive, it downloads all your photos and model files with a real progress bar. You only jump into the studio once everything is 100% ready and you click "Done".
- **Anti-Merge Protection**: If you try to save a project with a name that already exists in Google Drive or on your local disk, the app warns you and lets you pick a new name so your files never get merged or overwritten accidentally.
- **Easy Renaming**: You can rename any category or project at any time. Just click the pencil icon, type the new name, and hit Enter.
- **Fast Photo Management**: Deleting photos is instantaneous (0ms UI delay). You can also clear an entire category's photos in one click with the reset button.
- **Fast Training on Any Computer**: Instead of training a model from scratch (which takes hours and thousands of images), it uses **Transfer Learning** on MobileNetV2. A standard laptop CPU can train a model in about 20 seconds.

---

## Project Structure

```
Image_Classifiers/
├── Backend/
│   ├── main.py             # FastAPI backend server
│   ├── Training.py         # MobileNetV2 training code
│   ├── Prediction.py       # Runs predictions on test photos
│   ├── requirements.txt    # Python packages
│   ├── input/              # Current workspace photos
│   ├── output/             # Trained model (cat_dog_model.keras)
│   └── projects/           # Saved local projects
│
└── frontend/
    ├── src/
    │   ├── App.jsx            # Main app coordinator
    │   ├── StudioScreen.jsx   # 3-step studio (Dataset, Training, Predict & Save)
    │   ├── ProjectScreen.jsx  # Project launcher & Google Drive browser
    │   ├── components/DriveConnectDialog.jsx # Google OAuth for Drive actions
    │   ├── WelcomeScreen.jsx  # Quick intro tour
    │   └── lib/googleDrive.js # Direct Google Drive API helper
    ├── package.json
    └── vite.config.js
```

---

## Quick Start (How to Run It)

### What you need:
- **Python** (version 3.10, 3.11, or 3.12)
- **Node.js** (version 18 or newer)
- Git

---

### Step 1: Start the Backend

1. Open a terminal and move into the `Backend` folder:
   ```bash
   cd Backend
   ```

2. Create and activate a virtual environment:
   - **Windows (PowerShell):**
     ```powershell
     python -m venv venv
     .\venv\Scripts\Activate.ps1
     ```
   - **Mac / Linux:**
     ```bash
     python3 -m venv venv
     source venv/bin/activate
     ```

3. Install the Python packages:
   ```bash
   pip install -r requirements.txt
   ```

4. Start the backend:
   ```bash
   python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```
   You should see `Application startup complete`. The API runs at `http://localhost:8000`.

---

### Step 2: Start the Frontend

1. Open another terminal window and move into the `frontend` folder:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:5173` in your browser.

---

### Step 3: Google Drive Setup

To connect your Google Drive:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable the **Google Drive API**.
3. Under **Credentials**, create an **OAuth 2.0 Client ID** (Web application).
   - Authorized JavaScript origin: `http://localhost:5173`
   - Authorized redirect URI: `http://localhost:5173`
4. Put your client ID in `frontend/.env`:
   ```env
   VITE_GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   ```
5. Put your client ID and secret in `Backend/.env`:
   ```env
   GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="your-client-secret"
   ```

---

## How to Use the Studio

1. **Add Categories**: Type a name like `Dogs` or `Cats` and click **Add Class**. You need at least 2 categories to train.
2. **Add Photos**: Drag and drop images into each category box, or click **Upload**. You can also use your webcam.
3. **Train**: Click **Next: Model Training**, then click **Start Model Training**. The progress bar will update as epochs complete.
4. **Predict**: Drop in any test image. The app will show percentage confidence bars and highlight the winning category.
5. **Save**:
   - Click **Google Drive** to upload your dataset and model weights to your Drive.
   - Click **Local Disk** to download a `.zip` file with everything inside.

---

## API Cheat Sheet

If you want to call the backend from code or Postman:

| Endpoint | Method | What it does |
| :--- | :---: | :--- |
| `/classes` | `GET` | Get all categories and image lists |
| `/classes` | `POST` | Create a new category folder |
| `/classes/{name}` | `PUT` | Rename a category |
| `/classes/{name}` | `DELETE` | Delete a category and its photos |
| `/classes/{name}/clear` | `POST` | Remove all photos from a category |
| `/classes/{name}/images/{file}` | `DELETE` | Delete a single photo |
| `/upload` | `POST` | Upload photos to a category |
| `/train` | `POST` | Start background model training |
| `/train/status` | `GET` | Check if training is currently running |
| `/predict` | `POST` | Test a photo against the trained model |
| `/check-project-exists` | `POST` | Check if a project name is already taken |
| `/load-drive-project` | `POST` | Download a complete Drive project with progress |
| `/save-drive` | `POST` | Upload dataset and model to Google Drive |
| `/save-local` | `POST` | Save project to local disk storage |
| `/download-project/{name}` | `GET` | Download project as a `.zip` archive |
| `/load-local-model` | `POST` | Load a `.keras` or `.zip` project from disk |
| `/init-project` | `POST` | Clear temporary workspace for a fresh start |

---

## Common Questions

- **Why do I need at least 2 categories?** A classifier learns the differences *between* categories. If you only give it one, there is nothing to compare against!
- **Can I run this without a GPU?** Yes! The model is lightweight and specifically designed to train quickly on regular CPUs.
- **Will saving overwrite my existing files?** No. If a project with the same name already exists, the app stops and asks you to pick a new name so nothing gets overwritten or merged by mistake.
- **Do I lose my work if I close the tab?** If you're working locally, make sure to click **Local Disk** or **Google Drive** before exiting to keep your model and dataset.

---

## License

MIT License — free to use and tweak for your own projects!
