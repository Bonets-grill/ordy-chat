FROM mcr.microsoft.com/playwright/python:v1.58.0-noble

WORKDIR /app

# Base image ya trae Chromium + deps. Solo añadimos nuestras libs Python.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000

# Shell form para que ${PORT} expanda (Railway asigna puerto dinámico).
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
