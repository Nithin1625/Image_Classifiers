# --- Stage 1: Build the React application ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy application source code
COPY . .

# Accept Google Client ID as a build argument
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# Build the production bundle
RUN npm run build

# --- Stage 2: Serve using Nginx ---
FROM nginx:alpine

# Copy built static files from builder stage to Nginx web root
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy the custom Nginx config we created in Step 4
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]