# Deploy to Netlify and Render

## Backend (Render)
Create a Python web service from this repository. Set root directory to Backend, build command to `pip install -r requirements.txt`, and start command to `uvicorn main:app --host 0.0.0.0 --port $PORT`. Use Python 3.11 initially and enough RAM for TensorFlow training. Run one worker because the application uses shared in-memory training state.

Set CORS_ORIGINS to your exact Netlify origin, such as https://fastidious-granita-6fdced.netlify.app (no trailing slash). For Google Drive support, configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as backend environment variables. Never commit secrets. Verify the deployment at /docs.

## Frontend (Netlify)
Import this repository. The root netlify.toml sets the base directory to frontend, build command to npm run build, and publish directory to dist.

Set VITE_API_URL to the public HTTPS backend URL, with no trailing slash. Set VITE_GOOGLE_CLIENT_ID if using Google Drive, and authorize your Netlify origin in the Google OAuth client configuration. Redeploy after changing build variables.

For a manual upload, build the frontend locally, set window.CLASSIFIER_API_URL in dist/config.js to the public backend URL, and upload the contents of dist. index.html must be at the deployment root. The public/_redirects file handles page refreshes.

## Checks and limitations
Test creating a class, uploading images, training, prediction, and downloading a project. Google Drive additionally requires the OAuth settings above.

The current backend shares its workspace between visitors; this is suitable for a single-user demo. Add authentication and per-user workspace isolation before offering a public multi-user service. Data saved to the backend filesystem needs persistent storage; otherwise uploads and models can be lost after redeploys or restarts. Do not put private datasets in the repository.