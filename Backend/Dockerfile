# 1. Use an official lightweight Python 3.11 base image
FROM python:3.11-slim

# 2. Set the working directory inside the container
WORKDIR /app

# 3. Install system libraries needed by Pillow & TensorFlow
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 4. Copy requirements first so Docker can cache installed packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Copy the backend Python code into the container
COPY . .

# 6. Ensure input, output, and projects folders exist inside the container
RUN mkdir -p input output projects

# 7. Expose the port FastAPI runs on
EXPOSE 8000

# 8. Start Uvicorn when the container launches
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]