# runtime/app/logging_config.py — Logging estructurado en JSON para producción.

import json
import logging
import os
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Campos extra añadidos con logger.info(..., extra={...})
        for key, value in record.__dict__.items():
            if key in ("tenant_id", "tenant_slug", "phone", "mensaje_id", "provider",
                      "tokens_in", "tokens_out", "duration_ms", "event"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configurar_logging() -> None:
    """Reemplaza handlers del root logger con un StreamHandler JSON."""
    level = logging.DEBUG if os.getenv("ENVIRONMENT") == "development" else logging.INFO
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
    # Silenciar loggers ruidosos
    for name in ("httpx", "httpcore", "asyncpg", "anthropic"):
        logging.getLogger(name).setLevel(logging.WARNING)
