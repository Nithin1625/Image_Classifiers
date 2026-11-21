import os, shutil, uvicorn, json, requests, io, zipfile, uuid, threading
from builtins import str, bool, int, float, bytes, open, print, len, range, enumerate, Exception, ValueError, dict, list, sorted, min, round, GeneratorExit
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Dict, Any, List
from requests.adapters import HTTPAdapter
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, HTTPException, Body, Response
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from Prediction import predict_single_file, reload_predictor_model, resolve_model_path
from Training import train_model

app = FastAPI(title="Image Classification")
allowed_origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_DIR = os.path.join(BASE_DIR, "input")
os.makedirs(INPUT_DIR, exist_ok=True)
app.mount("/input-files", StaticFiles(directory=INPUT_DIR), name="input-files")

def load_backend_env():
    env_file = os.path.join(BASE_DIR, ".env")
    env = {}
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip() 
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV_VARS = load_backend_env()
GOOGLE_CLIENT_ID = ENV_VARS.get("GOOGLE_CLIENT_ID") or os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = ENV_VARS.get("GOOGLE_CLIENT_SECRET") or os.environ.get("GOOGLE_CLIENT_SECRET", "")

@app.post("/auth/google")
def exchange_google_code(payload: dict = Body(...)):
    code = payload.get("code")
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code.")

    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Google OAuth credentials not configured in Backend/.env.")

    token_url = "https://oauth2.googleapis.com/token"
    token_data = {
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": "postmessage",
        "grant_type": "authorization_code",
    }

    resp = requests.post(token_url, data=token_data)
    token_json = resp.json()
    if not resp.ok:
        err_msg = token_json.get("error_description") or token_json.get("error") or "Failed to exchange authorization code."
        raise HTTPException(status_code=400, detail=err_msg)

    access_token = token_json.get("access_token")
    refresh_token = token_json.get("refresh_token")
    expires_in = token_json.get("expires_in", 3599)

    user_info = None
    if access_token:
        try:
            u_resp = requests.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=5
            )
            if u_resp.ok:
                user_info = u_resp.json()
        except Exception as e:
            print(f"[WARN] Failed to fetch user info: {e}")

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": expires_in,
        "user": user_info
    }

@app.post("/auth/refresh")
def refresh_google_token(payload: dict = Body(...)):
    refresh_token = payload.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Missing refresh token.")

    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Google OAuth credentials not configured in Backend/.env.")

    token_url = "https://oauth2.googleapis.com/token"
    token_data = {
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }

    resp = requests.post(token_url, data=token_data)
    token_json = resp.json()
    if not resp.ok:
        err_msg = token_json.get("error_description") or token_json.get("error") or "Failed to refresh token."
        raise HTTPException(status_code=400, detail=err_msg)

    return {
        "access_token": token_json.get("access_token"),
        "expires_in": token_json.get("expires_in", 3599)
    }

is_training = False
training_lock = threading.Lock()

@app.get("/classes")
def get_classes_data():
    if not os.path.exists(INPUT_DIR):
        return {"classes": []}
    res = []
    for f in sorted(os.listdir(INPUT_DIR)):
        path = os.path.join(INPUT_DIR, f)
        if os.path.isdir(path) and not f.startswith("."):
            imgs = [f"/input-files/{f}/{x}" for x in os.listdir(path) if x.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp"))]
            res.append({"name": f, "samples": len(imgs), "images": imgs})
    return {"classes": res}

@app.post("/classes")
def add_class(class_name: str = Form(...)):
    name = class_name.strip().replace(" ", "_")
    if not name:
        raise HTTPException(status_code=400, detail="Class name cannot be empty.")
    path = os.path.join(INPUT_DIR, name)
    if os.path.exists(path):
        raise HTTPException(status_code=400, detail="Class already exists.")
    os.makedirs(path, exist_ok=True)
    return {"status": "success", "class_name": name}

@app.delete("/classes/{class_name}")
def delete_class(class_name: str):
    path = os.path.join(INPUT_DIR, class_name)
    if os.path.exists(path) and os.path.isdir(path):
        shutil.rmtree(path)
        return {"status": "success", "message": f"Class '{class_name}' deleted."}
    raise HTTPException(status_code=404, detail="Class not found.")

@app.delete("/classes/{class_name}/images/{filename}")
def delete_class_image(class_name: str, filename: str):
    clean_name = class_name.strip().replace(" ", "_")
    img_path = os.path.join(INPUT_DIR, clean_name, filename)
    if os.path.exists(img_path) and os.path.isfile(img_path):
        os.remove(img_path)
        return {"status": "success", "message": f"Image '{filename}' deleted."}
    raise HTTPException(status_code=404, detail="Image not found.")

@app.post("/classes/{class_name}/clear")
def clear_class_images(class_name: str):
    clean_name = class_name.strip().replace(" ", "_")
    target_dir = os.path.join(INPUT_DIR, clean_name)
    if os.path.exists(target_dir):
        for item in os.listdir(target_dir):
            p = os.path.join(target_dir, item)
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except Exception:
                pass
        return {"status": "success", "message": f"Cleared all images from '{class_name}'."}
    raise HTTPException(status_code=404, detail="Class not found.")

@app.put("/classes/{class_name}")
def rename_class(class_name: str, new_name: str = Form(...)):
    clean_old = class_name.strip().replace(" ", "_")
    clean_new = new_name.strip().replace(" ", "_")
    old_path = os.path.join(INPUT_DIR, clean_old)
    new_path = os.path.join(INPUT_DIR, clean_new)

    if not os.path.exists(old_path):
        raise HTTPException(status_code=404, detail="Class not found.")
    if os.path.exists(new_path):
        raise HTTPException(status_code=400, detail="A category with the new name already exists.")

    os.rename(old_path, new_path)
    return {"status": "success", "old_name": clean_old, "new_name": clean_new}

@app.post("/upload")
def upload_imgs(class_name: str = Form(...), files: list[UploadFile] = File(...)):
    clean_name = class_name.strip().replace(" ", "_")
    target_dir = os.path.join(INPUT_DIR, clean_name)
    os.makedirs(target_dir, exist_ok=True)
    count = 0
    for f in files:
        if f.filename:
            with open(os.path.join(target_dir, f.filename), "wb") as buf:
                shutil.copyfileobj(f.file, buf)
            count += 1
    return {"status": "success", "count": count}


def _train_task(google_token: Optional[str] = None, epochs: int = 10, batch_size: int = 32, learning_rate: float = 0.001, folder_name: str = "Image_Classifier", root_id: Optional[str] = None):
    global is_training
    try:
        if train_model(google_token=google_token, epochs=epochs, batch_size=batch_size, learning_rate=learning_rate, folder_name=folder_name, root_id=root_id):
            reload_predictor_model()
    finally:
        with training_lock:
            is_training = False

@app.post("/train")
def train_endpoint(tasks: BackgroundTasks, payload: dict = Body(default={})):
    global is_training
    with training_lock:
        if is_training:
            return {"status": "busy", "message": "Training already in progress."}
        is_training = True

    token = payload.get("google_token")
    epochs = int(payload.get("epochs", 10))
    batch_size = int(payload.get("batch_size", 32))
    learning_rate = float(payload.get("learning_rate", 0.001))
    folder_name = payload.get("folder_name", "Image_Classifier")
    root_id = payload.get("folder_id")

    # Guard: For local dataset, verify at least 2 classes and NO empty class folders
    if not token:
        if not os.path.exists(INPUT_DIR):
            with training_lock:
                is_training = False
            raise HTTPException(status_code=400, detail="Dataset folder not found. Please create categories and add photos.")
        class_dirs = [c for c in os.listdir(INPUT_DIR) if os.path.isdir(os.path.join(INPUT_DIR, c)) and not c.startswith(".")]
        if len(class_dirs) < 2:
            with training_lock:
                is_training = False
            raise HTTPException(status_code=400, detail="At least 2 categories are required to train.")
        empty_classes = []
        for c in class_dirs:
            c_path = os.path.join(INPUT_DIR, c)
            imgs = [x for x in os.listdir(c_path) if x.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp"))]
            if len(imgs) == 0:
                empty_classes.append(c)
        if empty_classes:
            with training_lock:
                is_training = False
            raise HTTPException(
                status_code=400,
                detail=f"Cannot train: Category '{empty_classes[0]}' has 0 photos. Every category must contain at least 1 photo."
            )

    try:
        tasks.add_task(_train_task, google_token=token, epochs=epochs, batch_size=batch_size, learning_rate=learning_rate, folder_name=folder_name, root_id=root_id)
    except Exception:
        with training_lock:
            is_training = False
        raise

    return {"status": "started", "message": "Training started in background."}

@app.get("/train/status")
def train_status():
    with training_lock:
        status = is_training
    return {"is_training": status}

@app.post("/predict")
def predict_endpoint(file: UploadFile = File(...)):
    with training_lock:
        training = is_training
    if training:
        raise HTTPException(status_code=503, detail="Model is currently training. Please wait.")
    contents = file.file.read()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    res = predict_single_file(contents)
    if "error" in res:
        raise HTTPException(status_code=500, detail=res["error"])
    return res

@app.post("/save-local")
def save_local_status(payload: dict = Body(default={})):
    project_name = payload.get("project_name", "My_Project")
    safe_name = "".join(c for c in project_name if c.isalnum() or c in ("_", "-")).strip() or "My_Project"
    overwrite = payload.get("overwrite", False)
    
    projects_dir = os.path.join(BASE_DIR, "projects", safe_name)
    if os.path.exists(projects_dir) and not overwrite:
        raise HTTPException(
            status_code=409,
            detail=f"A project named '{safe_name}' already exists on your local disk. Please choose a different project name to avoid merging or overwriting files."
        )
    os.makedirs(projects_dir, exist_ok=True)
    
    output_dir = os.path.join(BASE_DIR, "output")
    model_path = resolve_model_path(output_dir)
    classes_path = os.path.join(output_dir, "classes.json")
    
    proj_input = os.path.join(projects_dir, "input")
    proj_output = os.path.join(projects_dir, "output")
    
    if os.path.exists(INPUT_DIR):
        if os.path.exists(proj_input):
            shutil.rmtree(proj_input)
        shutil.copytree(INPUT_DIR, proj_input)
        
    if os.path.exists(output_dir):
        if os.path.exists(proj_output):
            shutil.rmtree(proj_output)
        shutil.copytree(output_dir, proj_output)
        
    return {
        "status": "success",
        "project_name": safe_name,
        "saved_path": projects_dir,
        "message": f"Successfully saved project '{safe_name}' to local disk at {projects_dir}!",
        "model_saved": os.path.exists(model_path),
        "classes_saved": os.path.exists(classes_path)
    }

@app.get("/download-project/{project_name}")
def download_project_endpoint(project_name: str):
    safe_name = "".join(c for c in project_name if c.isalnum() or c in ("_", "-")).strip() or "My_Project"
    
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        output_dir = os.path.join(BASE_DIR, "output")
        model_path = resolve_model_path(output_dir)
        classes_path = os.path.join(output_dir, "classes.json")
        
        if os.path.exists(model_path):
            zip_file.write(model_path, arcname=f"{safe_name}_model.keras")
        if os.path.exists(classes_path):
            zip_file.write(classes_path, arcname="classes.json")
            
        if os.path.exists(INPUT_DIR):
            for root, _, files in os.walk(INPUT_DIR):
                for f in files:
                    abs_f = os.path.join(root, f)
                    rel_f = os.path.relpath(abs_f, INPUT_DIR)
                    zip_file.write(abs_f, arcname=os.path.join("dataset", rel_f))
                    
        readme_content = f"Project: {safe_name}\nCreated via Image Classifier Studio\nIncludes:\n- {safe_name}_model.keras (Trained Neural Network)\n- classes.json (Category labels)\n- dataset/ (Training photos)\n"
        zip_file.writestr("README.txt", readme_content)
        
    zip_buffer.seek(0)
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}_project.zip"',
        "Access-Control-Expose-Headers": "Content-Disposition"
    }
    return Response(content=zip_buffer.getvalue(), media_type="application/zip", headers=headers)

@app.post("/load-local-model")
async def load_local_model_endpoint(file: UploadFile = File(...)):

    output_dir = os.path.join(BASE_DIR, "output")
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(INPUT_DIR, exist_ok=True)
    
    filename = file.filename or "model.keras"
    lower_name = filename.lower()
    
    if not (lower_name.endswith((".keras", ".h5", ".zip"))):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file format. Please select a model (.keras, .h5) or project archive (.zip)."
        )

    if lower_name.endswith(".zip"):
        contents = await file.read()
        zip_buffer = io.BytesIO(contents)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            for member in zf.namelist():
                if member.startswith("/") or ".." in member:
                    continue
                # Extract dataset photos into INPUT_DIR
                if member.startswith("dataset/"):
                    rel = member[len("dataset/"):]
                    if rel and not rel.endswith("/"):
                        dest = os.path.join(INPUT_DIR, rel)
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        with open(dest, "wb") as f:
                            f.write(zf.read(member))
                elif member.startswith("input/"):
                    rel = member[len("input/"):]
                    if rel and not rel.endswith("/"):
                        dest = os.path.join(INPUT_DIR, rel)
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        with open(dest, "wb") as f:
                            f.write(zf.read(member))
                # Extract model
                elif member.endswith((".keras", ".h5")):
                    dest = os.path.join(output_dir, "classifier_model.keras")
                    with open(dest, "wb") as f:
                        f.write(zf.read(member))
                # Extract classes.json
                elif member.endswith("classes.json"):
                    dest = os.path.join(output_dir, "classes.json")
                    with open(dest, "wb") as f:
                        f.write(zf.read(member))
    else:
        # Single .keras or .h5 model file
        model_dest = os.path.join(output_dir, "classifier_model.keras")
        contents = await file.read()
        with open(model_dest, "wb") as f:
            f.write(contents)
            
    # Ensure classes.json exists
    classes_json_path = os.path.join(output_dir, "classes.json")
    if not os.path.exists(classes_json_path):
        # 1. If INPUT_DIR already has class folders, use them
        existing_classes = sorted([c for c in os.listdir(INPUT_DIR) if os.path.isdir(os.path.join(INPUT_DIR, c)) and not c.startswith(".")])
        if existing_classes:
            with open(classes_json_path, "w") as f:
                json.dump(existing_classes, f)
        else:
            # 2. Try inferring from the model's output layer
            try:
                import tensorflow as tf
                loaded_m = tf.keras.models.load_model(os.path.join(output_dir, "classifier_model.keras"))
                num_classes = int(loaded_m.output_shape[-1]) if len(loaded_m.output_shape) > 1 else 2
                inferred = [f"Class_{i+1}" for i in range(num_classes)]
                with open(classes_json_path, "w") as f:
                    json.dump(inferred, f)
                for c in inferred:
                    os.makedirs(os.path.join(INPUT_DIR, c), exist_ok=True)
            except Exception as e:
                print("Could not infer classes from model:", e)

    # Reload predictor in memory
    reload_predictor_model()
    
    # Check classes
    classes_list = []
    if os.path.exists(INPUT_DIR):
        classes_list = [c for c in os.listdir(INPUT_DIR) if os.path.isdir(os.path.join(INPUT_DIR, c)) and not c.startswith(".")]
    elif os.path.exists(classes_json_path):
        try:
            with open(classes_json_path, "r") as f:
                classes_list = json.load(f)
        except Exception:
            pass
        
    proj_name = os.path.splitext(filename)[0].replace("_project", "").replace("_model", "")
    safe_name = "".join(c for c in proj_name if c.isalnum() or c in ("_", "-")).strip() or "Imported_Model"
    
    return {
        "status": "success",
        "message": f"Successfully loaded model '{filename}' into workspace!",
        "project_name": safe_name,
        "classes_count": len(classes_list),
        "classes": classes_list,
        "model_loaded": os.path.exists(os.path.join(output_dir, "classifier_model.keras"))
    }

def clear_folder(dir_path):
    """Safely empties a directory of all files and subfolders."""
    if os.path.exists(dir_path):
        for item in os.listdir(dir_path):
            p = os.path.join(dir_path, item)
            try:
                shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
            except Exception as e:
                print(f"[WARN] Error removing {p}: {e}")

def get_drive_error(resp):
    """Extracts human-readable error message from Google API responses."""
    try:
        return resp.json().get("error", {}).get("message", resp.text)
    except Exception:
        return resp.text

@app.post("/init-project")
def init_project(payload: dict = Body(default={})):
    """Clears temporary inputs and outputs for a fresh workspace."""
    clear_folder(INPUT_DIR)
    clear_folder(os.path.join(BASE_DIR, "output"))
    reload_predictor_model()
    return {"status": "success", "message": "Initialized clean project workspace."}

@app.post("/check-project-exists")
def check_project_exists(payload: dict = Body(...)):
    project_name = payload.get("project_name", "").strip()
    safe_name = "".join(c for c in project_name if c.isalnum() or c in ("_", "-")).strip()
    if not safe_name:
        return {"exists": False, "safe_name": ""}

    target = payload.get("target", "all")  # "all", "local", "drive"
    google_token = payload.get("google_token")

    # Only check Google Drive folders
    if target in ("all", "drive") and google_token:
        headers = {"Authorization": f"Bearer {google_token}"}
        q = f"name = '{safe_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        try:
            r = requests.get(
                "https://www.googleapis.com/drive/v3/files",
                params={"q": q, "fields": "files(id,name)"},
                headers=headers,
                timeout=10
            )
            if r.status_code == 200:
                files = r.json().get("files", [])
                if files:
                    return {
                        "exists": True,
                        "location": "drive",
                        "existing_name": files[0]["name"],
                        "message": f"A Google Drive folder named '{files[0]['name']}' already exists. Please choose a different name to avoid merging or overwriting files."
                    }
        except Exception as e:
            print(f"[WARN] Failed to check drive folder existence: {e}")

    return {"exists": False, "safe_name": safe_name}

@app.post("/load-drive-project")
def load_drive_project(payload: dict = Body(...)):
    google_token = payload.get("google_token")
    if not google_token:
        raise HTTPException(status_code=400, detail="Valid Google authentication token required. Please sign in with Google.")

    folder_id = payload.get("folder_id")
    folder_name = payload.get("folder_name", "Image_Classifier")
    file_id = payload.get("file_id")

    def event_stream():
        try:
            yield json.dumps({"type": "progress", "progress": 5, "message": "Connecting to Google Drive..."}) + "\n"

            # High-performance keep-alive connection pool session
            session = requests.Session()
            adapter = HTTPAdapter(pool_connections=20, pool_maxsize=20, max_retries=1)
            session.mount("https://", adapter)
            session.headers.update({"Authorization": f"Bearer {google_token}"})

            output_dir = os.path.join(BASE_DIR, "output")
            os.makedirs(output_dir, exist_ok=True)
            os.makedirs(INPUT_DIR, exist_ok=True)

            # 1. Clear current temporary workspace completely
            clear_folder(INPUT_DIR)
            clear_folder(output_dir)

            root_id = folder_id
            project_title = folder_name

            def _download_file(f_id, dest):
                try:
                    res = session.get(f"https://www.googleapis.com/drive/v3/files/{f_id}?alt=media", timeout=30)
                    if res.status_code == 200:
                        with open(dest, "wb") as f_out:
                            f_out.write(res.content)
                        return True
                except Exception as err:
                    print(f"[WARN] Failed to download file {f_id}: {err}")
                return False

            # 2. If user selected a specific file (.keras or .h5 model)
            if file_id:
                try:
                    f_resp = session.get(
                        f"https://www.googleapis.com/drive/v3/files/{file_id}?fields=id,name,parents",
                        timeout=10
                    )
                    if f_resp.status_code == 200:
                        f_meta = f_resp.json()
                        fname = f_meta.get("name", "classifier_model.keras")
                        if fname.lower().endswith((".keras", ".h5")):
                            _download_file(file_id, os.path.join(output_dir, "classifier_model.keras"))
                        parents = f_meta.get("parents", [])
                        if parents:
                            root_id = parents[0]
                            project_title = os.path.splitext(fname)[0].replace("_model", "").replace("_project", "")
                except Exception as e:
                    print(f"[WARN] Error loading specific file from Drive: {e}")

            # 3. Resolve root folder ID if not provided
            if not root_id:
                q = f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                try:
                    r = session.get("https://www.googleapis.com/drive/v3/files", params={"q": q, "fields": "files(id,name)"}, timeout=15)
                    if r.status_code == 200:
                        files = r.json().get("files", [])
                        if files:
                            root_id = files[0]["id"]
                            project_title = files[0]["name"]
                except Exception as e:
                    yield json.dumps({"type": "error", "detail": f"Google Drive search failed: {e}"}) + "\n"
                    return

            if not root_id:
                yield json.dumps({"type": "error", "detail": f"Folder '{folder_name}' not found in Google Drive."}) + "\n"
                return

            yield json.dumps({"type": "progress", "progress": 10, "message": "Inspecting project folders..."}) + "\n"

            # 4. If root_id is an 'input' or 'output' folder, resolve to its parent project folder
            try:
                r_meta = session.get(f"https://www.googleapis.com/drive/v3/files/{root_id}?fields=id,name,parents", timeout=10)
                if r_meta.status_code == 200:
                    meta = r_meta.json()
                    m_name = meta.get("name", "")
                    if m_name in ("input", "output") and meta.get("parents"):
                        root_id = meta["parents"][0]
                        p_meta = session.get(f"https://www.googleapis.com/drive/v3/files/{root_id}?fields=id,name", timeout=10)
                        if p_meta.status_code == 200:
                            project_title = p_meta.json().get("name", folder_name)
                    else:
                        project_title = m_name or folder_name
            except Exception as e:
                print(f"[WARN] Error resolving root folder parent: {e}")

            # 5. Look for 'input' and 'output' folders concurrently
            target_container_id = root_id
            output_folder_id = None
            try:
                q_sub = f"'{root_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                r_sub = session.get("https://www.googleapis.com/drive/v3/files", params={"q": q_sub, "fields": "files(id,name)"}, timeout=15)
                if r_sub.status_code == 200:
                    for sf in r_sub.json().get("files", []):
                        if sf["name"] == "input":
                            target_container_id = sf["id"]
                        elif sf["name"] == "output":
                            output_folder_id = sf["id"]
            except Exception as e:
                print(f"[WARN] Error checking for subfolders: {e}")

            # 6. Find category folders inside target_container_id (excluding 'input' and 'output')
            q_classes = f"'{target_container_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
            class_folders = []
            try:
                r_cls = session.get("https://www.googleapis.com/drive/v3/files", params={"q": q_classes, "fields": "files(id,name)", "pageSize": 100}, timeout=15)
                if r_cls.status_code == 200:
                    class_folders = [f for f in r_cls.json().get("files", []) if f["name"] not in ("input", "output")]
            except Exception as e:
                yield json.dumps({"type": "error", "detail": f"Failed to list categories from Google Drive: {e}"}) + "\n"
                return

            yield json.dumps({
                "type": "progress",
                "progress": 15,
                "message": f"Found {len(class_folders)} categories. Scanning files..."
            }) + "\n"

            # 7. Concurrently list photos across all category folders in parallel
            def _list_category_photos(c_folder):
                c_name = c_folder["name"].strip().replace(" ", "_")
                c_dir = os.path.join(INPUT_DIR, c_name)
                os.makedirs(c_dir, exist_ok=True)
                tasks = []
                q_imgs = f"'{c_folder['id']}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
                try:
                    r_imgs = session.get("https://www.googleapis.com/drive/v3/files", params={"q": q_imgs, "fields": "files(id,name,mimeType)", "pageSize": 1000}, timeout=20)
                    if r_imgs.status_code == 200:
                        for im in r_imgs.json().get("files", []):
                            lower = im["name"].lower()
                            if lower.endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")) or (im.get("mimeType", "").startswith("image/")):
                                tasks.append((im["id"], os.path.join(c_dir, im["name"])))
                except Exception as e:
                    print(f"[WARN] Error listing photos for class '{c_name}': {e}")
                return tasks

            download_tasks = []
            if class_folders:
                with ThreadPoolExecutor(max_workers=min(12, len(class_folders))) as l_exec:
                    cat_results = list(l_exec.map(_list_category_photos, class_folders))
                    for cat_list in cat_results:
                        download_tasks.extend(cat_list)

            total_photos_downloaded = 0
            total_files = len(download_tasks)

            # Download photos with actual proportional progress
            if total_files > 0:
                yield json.dumps({
                    "type": "progress",
                    "progress": 20,
                    "completed": 0,
                    "total": total_files,
                    "message": f"Downloading photos (0/{total_files})..."
                }) + "\n"

                with ThreadPoolExecutor(max_workers=16) as d_exec:
                    future_to_task = {d_exec.submit(_download_file, t[0], t[1]): t for t in download_tasks}
                    completed_count = 0
                    for future in as_completed(future_to_task):
                        try:
                            if future.result():
                                total_photos_downloaded += 1
                        except Exception:
                            pass
                        completed_count += 1
                        # Map completed_count strictly to 20% - 90%
                        pct = 20 + int((completed_count / total_files) * 70)
                        yield json.dumps({
                            "type": "progress",
                            "progress": pct,
                            "completed": completed_count,
                            "total": total_files,
                            "message": f"Downloading photos ({completed_count}/{total_files})..."
                        }) + "\n"
            else:
                yield json.dumps({
                    "type": "progress",
                    "progress": 50,
                    "message": "Checking project model files..."
                }) + "\n"

            # 8. Check for trained model and classes.json in output/ folder if present
            yield json.dumps({"type": "progress", "progress": 92, "message": "Checking trained model..."}) + "\n"
            model_loaded = os.path.exists(os.path.join(output_dir, "classifier_model.keras"))
            if output_folder_id:
                try:
                    q_out_files = f"'{output_folder_id}' in parents and trashed = false"
                    r_out_files = session.get("https://www.googleapis.com/drive/v3/files", params={"q": q_out_files, "fields": "files(id,name)", "pageSize": 50}, timeout=15)
                    if r_out_files.status_code == 200:
                        for f in r_out_files.json().get("files", []):
                            f_name = f["name"].lower()
                            if not model_loaded and (f_name.endswith(".keras") or f_name.endswith(".h5")):
                                yield json.dumps({"type": "progress", "progress": 94, "message": "Downloading trained neural network..."}) + "\n"
                                _download_file(f["id"], os.path.join(output_dir, "classifier_model.keras"))
                                model_loaded = True
                            elif f_name == "classes.json":
                                _download_file(f["id"], os.path.join(output_dir, "classes.json"))
                except Exception as e:
                    print(f"[WARN] Error checking output folder in Drive: {e}")

            # Ensure classes.json exists
            classes_json_path = os.path.join(output_dir, "classes.json")
            category_names = sorted([c for c in os.listdir(INPUT_DIR) if os.path.isdir(os.path.join(INPUT_DIR, c)) and not c.startswith(".")])
            if not os.path.exists(classes_json_path) and category_names:
                with open(classes_json_path, "w") as jf:
                    json.dump(category_names, jf)

            if model_loaded:
                yield json.dumps({"type": "progress", "progress": 96, "message": "Loading neural network into memory..."}) + "\n"
                reload_predictor_model()

            yield json.dumps({"type": "progress", "progress": 99, "message": "Finalizing workspace..."}) + "\n"

            # Build response classes list
            classes_res = []
            for c in category_names:
                c_path = os.path.join(INPUT_DIR, c)
                imgs = [f"/input-files/{c}/{x}" for x in os.listdir(c_path) if x.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp"))]
                classes_res.append({"name": c, "samples": len(imgs), "images": imgs})

            safe_title = "".join(c for c in project_title if c.isalnum() or c in ("_", "-")).strip() or "Drive_Project"

            yield json.dumps({
                "type": "complete",
                "progress": 100,
                "status": "success",
                "project_name": safe_title,
                "folder_id": root_id,
                "classes_count": len(classes_res),
                "total_photos": total_photos_downloaded,
                "classes": classes_res,
                "model_loaded": model_loaded
            }) + "\n"

        except GeneratorExit:
            pass
        except Exception as err:
            print(f"[ERROR] Error in load_drive_project stream: {err}")
            yield json.dumps({"type": "error", "detail": str(err)}) + "\n"

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )

def drive_get_or_create_folder(headers, name, parent_id=None):
    """Finds an existing folder or creates it in Google Drive."""
    q = f"name = '{name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    if parent_id:
        q += f" and '{parent_id}' in parents"
    
    try:
        r = requests.get(
            "https://www.googleapis.com/drive/v3/files",
            params={"q": q, "fields": "files(id,name)"},
            headers=headers,
            timeout=20
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Google Drive connection failed: {e}")

    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Google authentication token has expired. Please sign out and sign in again.")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=f"Google Drive search error: {get_drive_error(r)}")

    files = r.json().get("files", [])
    if files:
        return files[0]["id"]

    meta = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent_id:
        meta["parents"] = [parent_id]

    try:
        cr = requests.post("https://www.googleapis.com/drive/v3/files", headers=headers, json=meta, timeout=20)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Google Drive connection failed: {e}")

    if cr.status_code == 401:
        raise HTTPException(status_code=401, detail="Google authentication token has expired. Please sign out and sign in again.")
    if cr.status_code not in (200, 201):
        raise HTTPException(status_code=cr.status_code, detail=f"Google Drive folder creation failed: {get_drive_error(cr)}")

    folder_id = cr.json().get("id")
    if not folder_id:
        raise HTTPException(status_code=500, detail=f"Failed to obtain ID for created folder '{name}'.")
    return folder_id

def drive_get_existing_filenames(headers, folder_id):
    """Fetches all existing file names in a folder in ONE single fast request."""
    if not folder_id:
        return {}
    q = f"'{folder_id}' in parents and trashed = false"
    try:
        r = requests.get(
            "https://www.googleapis.com/drive/v3/files",
            params={"q": q, "fields": "files(id,name)", "pageSize": 1000},
            headers=headers,
            timeout=20
        )
        if r.status_code == 200:
            return {f["name"]: f["id"] for f in r.json().get("files", [])}
    except Exception as e:
        print(f"[WARN] Error fetching existing filenames for folder {folder_id}: {e}")
    return {}

def drive_resumable_upload(headers, local_path, file_name, parent_id, file_id=None, mime_type="application/octet-stream"):
    """Resumable upload session for large files (> 4.5MB) like trained .keras models."""
    file_size = os.path.getsize(local_path)
    meta = {"name": file_name}
    if not file_id and parent_id:
        meta["parents"] = [parent_id]

    init_url = (
        f"https://www.googleapis.com/upload/drive/v3/files/{file_id}?uploadType=resumable"
        if file_id
        else "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"
    )
    init_headers = {
        "Authorization": headers["Authorization"],
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime_type,
        "X-Upload-Content-Length": str(file_size)
    }
    method = requests.patch if file_id else requests.post
    init_res = method(init_url, headers=init_headers, json=meta, timeout=30)
    if init_res.status_code not in (200, 201):
        raise Exception(f"Failed to initiate resumable upload for {file_name} ({init_res.status_code}): {get_drive_error(init_res)}")

    upload_url = init_res.headers.get("Location")
    if not upload_url:
        raise Exception(f"No upload Location header returned from Google Drive for {file_name}")

    with open(local_path, "rb") as f:
        upload_headers = {
            "Content-Length": str(file_size),
            "Content-Type": mime_type
        }
        upload_res = requests.put(upload_url, headers=upload_headers, data=f, timeout=300)

    if upload_res.status_code not in (200, 201):
        raise Exception(f"Resumable upload body failed for {file_name} ({upload_res.status_code}): {get_drive_error(upload_res)}")

    return upload_res.json().get("id")

def drive_upload_file(headers, local_path, file_name, parent_id, existing_files=None):
    """
    Uploads a file to Google Drive using:
    - Resumable upload for files > 4.5MB (like Keras model weights)
    - RFC 2387 multipart/related upload for files <= 4.5MB (like photos and JSON)
    """
    if not os.path.exists(local_path):
        print(f"[WARN] File does not exist for upload: {local_path}")
        return None

    file_id = existing_files.get(file_name) if existing_files else None
    file_size = os.path.getsize(local_path)
    
    # MIME type detection
    lower = file_name.lower()
    if lower.endswith((".jpg", ".jpeg")):
        mime_type = "image/jpeg"
    elif lower.endswith(".png"):
        mime_type = "image/png"
    elif lower.endswith(".webp"):
        mime_type = "image/webp"
    elif lower.endswith(".json"):
        mime_type = "application/json"
    else:
        mime_type = "application/octet-stream"

    # For large files (> 4.5MB), use Google Drive Resumable Upload
    if file_size > 4.5 * 1024 * 1024:
        return drive_resumable_upload(headers, local_path, file_name, parent_id, file_id, mime_type)

    # For smaller files, use RFC 2387 multipart/related
    with open(local_path, "rb") as f:
        file_bytes = f.read()

    meta = {"name": file_name}
    if not file_id and parent_id:
        meta["parents"] = [parent_id]

    boundary = f"=====ImageClassifierBoundary{uuid.uuid4().hex}====="
    body = (
        f"--{boundary}\r\n"
        f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{json.dumps(meta)}\r\n"
        f"--{boundary}\r\n"
        f"Content-Type: {mime_type}\r\n\r\n"
    ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req_headers = {
        "Authorization": headers["Authorization"],
        "Content-Type": f"multipart/related; boundary={boundary}",
        "Content-Length": str(len(body))
    }

    if file_id:
        url = f"https://www.googleapis.com/upload/drive/v3/files/{file_id}?uploadType=multipart"
        res = requests.patch(url, headers=req_headers, data=body, timeout=60)
    else:
        url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
        res = requests.post(url, headers=req_headers, data=body, timeout=60)

    if res.status_code not in (200, 201):
        err_msg = res.text
        try:
            err_msg = res.json().get("error", {}).get("message", res.text)
        except Exception:
            pass
        raise Exception(f"Google Drive multipart upload failed for {file_name} ({res.status_code}): {err_msg}")

    return res.json().get("id")

@app.post("/save-drive")
def save_drive_endpoint(payload: dict = Body(...)):
    google_token = payload.get("google_token")
    if not google_token:
        raise HTTPException(status_code=400, detail="Valid Google authentication token required to save to Drive. Please sign in with Google.")
    project_name = payload.get("project_name", "Image_Classifier")
    safe_name = "".join(c for c in project_name if c.isalnum() or c in ("_", "-")).strip() or "Image_Classifier"
    overwrite = payload.get("overwrite", False)
    
    headers = {"Authorization": f"Bearer {google_token}"}
    
    # 1. Root folder for project: check if already exists if overwrite is False
    q_check = f"name = '{safe_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    existing_root_id = None
    try:
        r_chk = requests.get(
            "https://www.googleapis.com/drive/v3/files",
            params={"q": q_check, "fields": "files(id,name)"},
            headers=headers,
            timeout=15
        )
        if r_chk.status_code == 200:
            found = r_chk.json().get("files", [])
            if found:
                existing_root_id = found[0]["id"]
    except Exception as e:
        print(f"[WARN] Error checking folder existence in Drive: {e}")

    if existing_root_id and not overwrite:
        raise HTTPException(
            status_code=409,
            detail=f"A Google Drive folder named '{safe_name}' already exists. Please choose a different name to avoid merging or overwriting files."
        )

    root_id = existing_root_id or drive_get_or_create_folder(headers, safe_name)
    if not root_id:
        raise HTTPException(status_code=500, detail=f"Failed to create project folder '{safe_name}' in Google Drive.")
        
    # 2. input and output folders
    input_id = drive_get_or_create_folder(headers, "input", root_id)
    output_id = drive_get_or_create_folder(headers, "output", root_id)
    
    # 3. High-speed parallel upload of missing photos with ThreadPoolExecutor
    uploaded_files_count = 0
    upload_tasks = []
    
    if os.path.exists(INPUT_DIR):
        for c in os.listdir(INPUT_DIR):
            c_dir = os.path.join(INPUT_DIR, c)
            if os.path.isdir(c_dir) and not c.startswith("."):
                class_folder_id = drive_get_or_create_folder(headers, c, input_id)
                existing_in_class = drive_get_existing_filenames(headers, class_folder_id)
                for img_name in os.listdir(c_dir):
                    img_path = os.path.join(c_dir, img_name)
                    if os.path.isfile(img_path) and img_name not in existing_in_class:
                        upload_tasks.append((img_path, img_name, class_folder_id))
    
    upload_errors = []
    if upload_tasks:
        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = [
                executor.submit(drive_upload_file, headers, path, name, pid, {})
                for path, name, pid in upload_tasks
            ]
            for f in futures:
                try:
                    res_id = f.result()
                    if res_id:
                        uploaded_files_count += 1
                except Exception as e:
                    print(f"[ERROR] Drive photo upload error: {e}")
                    upload_errors.append(str(e))
                        
    # 4. Upload model and classes to output/
    output_dir = os.path.join(BASE_DIR, "output")
    model_path = resolve_model_path(output_dir)
    if not os.path.exists(model_path) and os.path.exists(output_dir):
        keras_files = [f for f in os.listdir(output_dir) if f.endswith((".keras", ".h5"))]
        if keras_files:
            model_path = os.path.join(output_dir, keras_files[0])
            
    classes_path = os.path.join(output_dir, "classes.json")
    
    existing_in_output = drive_get_existing_filenames(headers, output_id)
    
    model_uploaded = False
    if os.path.exists(model_path):
        try:
            drive_upload_file(headers, model_path, f"{safe_name}_model.keras", output_id, existing_in_output)
            model_uploaded = True
        except Exception as e:
            print(f"[ERROR] Model upload error: {e}")
            upload_errors.append(f"Model upload: {e}")
            
    classes_uploaded = False
    if os.path.exists(classes_path):
        try:
            drive_upload_file(headers, classes_path, "classes.json", output_id, existing_in_output)
            classes_uploaded = True
        except Exception as e:
            print(f"[ERROR] Classes upload error: {e}")
            upload_errors.append(f"Classes upload: {e}")
            
    if upload_errors and uploaded_files_count == 0 and not model_uploaded and not classes_uploaded:
        raise HTTPException(status_code=502, detail=f"Google Drive upload failed: {upload_errors[0]}")
        
    status_msg = f"Successfully saved to Google Drive under '{safe_name}/' ({uploaded_files_count} photos synced"
    if model_uploaded:
        status_msg += f" + {safe_name}_model.keras saved"
    if classes_uploaded:
        status_msg += " + classes.json saved"
    status_msg += ")!"
    
    return {
        "status": "success",
        "project_name": safe_name,
        "message": status_msg,
        "root_folder_id": root_id,
        "uploaded_photos": uploaded_files_count,
        "model_uploaded": model_uploaded,
        "classes_uploaded": classes_uploaded
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

