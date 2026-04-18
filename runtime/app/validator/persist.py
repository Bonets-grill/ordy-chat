# runtime/app/validator/persist.py — INSERT/UPDATE a validator_runs + _messages.
#
# Todo INSERT hace SET LOCAL app.current_tenant_id = $1::text DENTRO de una
# transacción, antes del INSERT. Respeta RLS (actualmente dormida con el owner
# Neon — activará cuando se migre a non-superuser).

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from app.memory import inicializar_pool

logger = logging.getLogger("ordychat.validator.persist")


async def crear_run(
    tenant_id: UUID,
    triggered_by: str,
    nicho: str,
) -> UUID:
    """INSERT validator_runs con status='running'. Retorna el id del run."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SET LOCAL app.current_tenant_id = $1",
                str(tenant_id),
            )
            row = await conn.fetchrow(
                """
                INSERT INTO validator_runs (tenant_id, triggered_by, nicho, status)
                VALUES ($1, $2, $3, 'running')
                RETURNING id
                """,
                tenant_id, triggered_by, nicho,
            )
    return row["id"]


async def guardar_mensaje(
    run_id: UUID,
    tenant_id: UUID,
    seed: dict[str, Any],
    response_text: str,
    tools_called: list[dict[str, Any]],
    asserts_result: dict[str, bool],
    judge_scores: dict[str, int],
    judge_notes: str,
    verdict: str,
    tokens_in: int,
    tokens_out: int,
    duration_ms: int,
) -> None:
    """INSERT validator_messages con una semilla evaluada."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SET LOCAL app.current_tenant_id = $1",
                str(tenant_id),
            )
            await conn.execute(
                """
                INSERT INTO validator_messages (
                    run_id, tenant_id, seed_id, seed_text, seed_expected_action,
                    response_text, tools_called, asserts_result, judge_scores,
                    judge_notes, verdict, tokens_in, tokens_out, duration_ms
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
                        $10, $11, $12, $13, $14)
                """,
                run_id,
                tenant_id,
                seed.get("id"),
                seed.get("text"),
                seed.get("expected_action"),
                response_text,
                json.dumps(tools_called, ensure_ascii=False),
                json.dumps(asserts_result, ensure_ascii=False),
                json.dumps(judge_scores, ensure_ascii=False),
                judge_notes,
                verdict,
                tokens_in,
                tokens_out,
                duration_ms,
            )


async def cerrar_run(
    run_id: UUID,
    tenant_id: UUID,
    status: str,
    summary: dict[str, Any],
    autopatch_attempts: int = 0,
    autopatch_applied_at: datetime | None = None,
    previous_system_prompt: str | None = None,
    paused_by_this_run: bool = False,
) -> None:
    """UPDATE validator_runs con el estado final del run."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SET LOCAL app.current_tenant_id = $1",
                str(tenant_id),
            )
            await conn.execute(
                """
                UPDATE validator_runs
                SET status = $2,
                    summary_json = $3::jsonb,
                    autopatch_attempts = $4,
                    autopatch_applied_at = $5,
                    previous_system_prompt = $6,
                    paused_by_this_run = $7,
                    completed_at = now()
                WHERE id = $1
                """,
                run_id,
                status,
                json.dumps(summary, ensure_ascii=False),
                autopatch_attempts,
                autopatch_applied_at,
                previous_system_prompt,
                paused_by_this_run,
            )


async def marcar_agente_pausado(
    tenant_id: UUID,
    razon: str,
) -> None:
    """UPDATE agent_configs SET paused=true por tenant_id. Llamado desde runner
    tras FAIL crítico post-autopatch. Log a audit_log."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SET LOCAL app.current_tenant_id = $1",
                str(tenant_id),
            )
            await conn.execute(
                """
                UPDATE agent_configs
                SET paused = true, updated_at = now()
                WHERE tenant_id = $1
                """,
                tenant_id,
            )
            await conn.execute(
                """
                INSERT INTO audit_log (tenant_id, action, entity, entity_id, metadata)
                VALUES ($1, 'validator_pause_agent', 'agent_configs', $1::text, $2::jsonb)
                """,
                tenant_id,
                json.dumps({"razon": razon}, ensure_ascii=False),
            )


async def aplicar_autopatch(
    tenant_id: UUID,
    nuevo_prompt: str,
    prompt_anterior: str,
) -> None:
    """UPDATE agent_configs.system_prompt. Snapshot del anterior ya se guardó
    en validator_runs.previous_system_prompt por el runner ANTES de llamar."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SET LOCAL app.current_tenant_id = $1",
                str(tenant_id),
            )
            await conn.execute(
                """
                UPDATE agent_configs
                SET system_prompt = $2, updated_at = now()
                WHERE tenant_id = $1
                """,
                tenant_id,
                nuevo_prompt,
            )
            await conn.execute(
                """
                INSERT INTO audit_log (tenant_id, action, entity, entity_id, metadata)
                VALUES ($1, 'validator_autopatch_applied', 'agent_configs', $1::text, $2::jsonb)
                """,
                tenant_id,
                json.dumps(
                    {
                        "prompt_anterior_len": len(prompt_anterior),
                        "nuevo_prompt_len": len(nuevo_prompt),
                        "delta_chars": len(nuevo_prompt) - len(prompt_anterior),
                    },
                    ensure_ascii=False,
                ),
            )
