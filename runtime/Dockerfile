FROM mcr.microsoft.com/playwright/python:v1.58.0-noble

WORKDIR /app

# Build context = raíz del repo (ver railway.toml en raíz). Por eso los COPY
# llevan prefijo `runtime/`. Para build local desde runtime/ usar:
#   docker build -f runtime/Dockerfile . (desde raíz del repo, no desde runtime/)
COPY runtime/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY runtime/app ./app

EXPOSE 8000

# Shell form para que ${PORT} expanda (Railway asigna puerto dinámico).
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
