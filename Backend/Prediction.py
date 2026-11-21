import os
import io
import json
from builtins import str, bool, int, float, bytes, open, print, round, enumerate, Exception
from typing import Dict, Any, List, Optional
import numpy as np
import tensorflow as tf
from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLASSES_PATH = os.path.join(BASE_DIR, "output", "classes.json")

model: Optional[Any] = None
classes: List[str] = []

def resolve_model_path(output_dir: str) -> str:
    model_path = os.path.join(output_dir, "classifier_model.keras")
    legacy_path = os.path.join(output_dir, "cat_dog_model.keras")
    if not os.path.exists(model_path) and os.path.isfile(legacy_path):
        return legacy_path
    return model_path

def reload_predictor_model() -> bool:
    global model, classes
    model_path = resolve_model_path(os.path.join(BASE_DIR, "output"))
    if os.path.exists(model_path) and os.path.exists(CLASSES_PATH):
        try:
            model = tf.keras.models.load_model(model_path)
            with open(CLASSES_PATH, "r", encoding="utf-8") as f:
                classes = json.load(f)
            return True
        except Exception as e:
            print("Error loading model:", e)
    model = None
    classes = []
    return False

def predict_single_file(image_bytes: bytes) -> Dict[str, Any]:
    if model is None and not reload_predictor_model():
        return {"error": "Model not trained yet."}
    if model is None:
        return {"error": "Model not trained yet."}
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((150, 150))
        img_arr = np.expand_dims(np.array(img, dtype=np.float32), axis=0)
        preds = model.predict(img_arr, verbose=0)[0]
        scores = {cls: round(float(preds[i]) * 100, 1) for i, cls in enumerate(classes)}
        top_idx = int(np.argmax(preds))
        return {"top_class": classes[top_idx], "all_scores": scores}
    except Exception as e:
        return {"error": str(e)}

reload_predictor_model()