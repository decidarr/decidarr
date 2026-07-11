FROM node:22-slim AS webbuild
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY --from=webbuild /web/dist ./static
ENV DB_PATH=/data/decidarr.db STATIC_DIR=/app/static
VOLUME /data
EXPOSE 5454
HEALTHCHECK --interval=60s --timeout=5s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:5454/api/health')"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5454"]
