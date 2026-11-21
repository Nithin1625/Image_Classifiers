import os
import json
import shutil
import tempfile
from urllib.parse import quote
from builtins import str, bool, int, float, bytes, open, print, len, range, enumerate, Exception, ValueError
from typing import Optional, List, Dict, Any

import requests
import tensorflow as tf

layers = tf.keras.layers
models = tf.keras.models
MobileNetV2 = tf.keras.applications.MobileNetV2

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_drive_files(query, token):
    url = f"https://www.googleapis.com/drive/v3/files?q={quote(query)}&pageSize=1000"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.get(url, headers=headers, timeout=25)
    except Exception as e:
        raise ValueError(f"Google Drive connection failed: {e}")

    if response.status_code == 401:
        raise ValueError("Google authentication token has expired. Please sign out and sign in again.")
    if response.status_code != 200:
        err_msg = response.text
        try:
            err_msg = response.json().get("error", {}).get("message", response.text)
        except Exception:
            pass
        raise ValueError(f"Google Drive error ({response.status_code}): {err_msg}")

    return response.json().get("files", [])

def download_dataset_from_drive(token, folder_name="Image_Classifier", root_id=None):
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Find the main project folder if root_id is not given
    if not root_id:
        folders = get_drive_files(f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", token)
        if not folders:
            raise ValueError(f"'{folder_name}' folder not found in Google Drive.")
        root_id = folders[0]["id"]

    # 2. Check if there is an 'input' folder inside root_id. If not, root_id itself contains the classes
    inputs = get_drive_files(f"'{root_id}' in parents and name = 'input' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", token)
    target_container_id = inputs[0]["id"] if inputs else root_id

    # 3. Find category folders inside target_container_id (excluding internal folders 'input' and 'output')
    all_subfolders = get_drive_files(f"'{target_container_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false", token)
    classes = [f for f in all_subfolders if f["name"] not in ("input", "output")]

    if len(classes) < 2:
        raise ValueError(f"Need at least 2 categories in Google Drive to train. Found: {len(classes)}")

    temp_dir = tempfile.mkdtemp(prefix="image_classifier_drive_")

    for folder in classes:
        class_dir = os.path.join(temp_dir, folder["name"])
        os.makedirs(class_dir, exist_ok=True)

        files = get_drive_files(f"'{folder['id']}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'", token)
        if len(files) == 0:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise ValueError(f"Category '{folder['name']}' has 0 photos in Google Drive. Every category must have at least 1 photo to train.")

        for f in files:
            try:
                img_res = requests.get(f"https://www.googleapis.com/drive/v3/files/{f['id']}?alt=media", headers=headers, timeout=30)
                if img_res.status_code == 200:
                    with open(os.path.join(class_dir, f["name"]), "wb") as file_out:
                        file_out.write(img_res.content)
                else:
                    print(f"[WARN] Failed to download {f['name']} ({img_res.status_code})")
            except Exception as dl_err:
                print(f"[WARN] Error downloading file {f['name']}: {dl_err}")

    return temp_dir

def train_model(google_token: Optional[str] = None, epochs: int = 10, batch_size: int = 32, learning_rate: float = 0.001, folder_name: str = "Image_Classifier", root_id: Optional[str] = None) -> bool:
    output_dir = os.path.join(BASE_DIR, "output")
    os.makedirs(output_dir, exist_ok=True)
    temp_dir = None

    try:
        # Step 1: Get training directory
        if google_token:
            print(f"[INFO] Fetching images from Google Drive: {folder_name}")
            temp_dir = download_dataset_from_drive(google_token, folder_name, root_id)
            train_dir = temp_dir
        else:
            train_dir = os.path.join(BASE_DIR, "input")

        if not os.path.exists(train_dir):
            print(f"[ERROR] Directory '{train_dir}' not found.")
            return False

        # Step 2: Validate classes and images
        class_folders = [d for d in os.listdir(train_dir) if os.path.isdir(os.path.join(train_dir, d)) and not d.startswith(".")]
        if len(class_folders) < 2:
            print(f"[ERROR] Need at least 2 classes to train. Found: {len(class_folders)}")
            return False

        for folder in class_folders:
            folder_path = os.path.join(train_dir, folder)
            images = [img for img in os.listdir(folder_path) if img.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp"))]
            if len(images) == 0:
                print(f"[ERROR] Class '{folder}' has 0 photos. Each class must have at least 1 photo to train.")
                return False

        # Step 3: Load dataset
        raw_ds = tf.keras.utils.image_dataset_from_directory(
            train_dir, image_size=(150, 150), batch_size=batch_size, label_mode="categorical"
        )
        classes = raw_ds.class_names
        with open(os.path.join(output_dir, "classes.json"), "w") as f:
            json.dump(classes, f)

        train_ds = raw_ds.cache().prefetch(buffer_size=tf.data.AUTOTUNE)

        # Step 4: Build model using MobileNetV2
        base_model = MobileNetV2(input_shape=(150, 150, 3), include_top=False, weights="imagenet")
        base_model.trainable = False

        model = models.Sequential([
            layers.Input((150, 150, 3)),
            layers.Rescaling(scale=1./127.5, offset=-1),
            layers.RandomFlip("horizontal"),
            layers.RandomRotation(0.1),
            base_model,
            layers.GlobalAveragePooling2D(),
            layers.Dropout(0.2),
            layers.Dense(len(classes), activation="softmax")
        ])

        # Step 5: Compile and train
        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=learning_rate),
            loss="categorical_crossentropy",
            metrics=["accuracy"]
        )
        model.fit(train_ds, epochs=epochs)

        # Step 6: Save trained model
        model.save(os.path.join(output_dir, "classifier_model.keras"))
        print("[INFO] Model saved successfully.")
        return True

    except Exception as e:
        print(f"[ERROR] Training failed: {e}")
        return False
    finally:
        # Step 7: Clean up temporary files if created
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
            print("[INFO] Cleaned up temporary files.")

if __name__ == "__main__":
    train_model()


