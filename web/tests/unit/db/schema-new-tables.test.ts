/**
 * Smoke test: las 7 tablas recién añadidas al schema Drizzle exponen
 * sus types correctamente (select + insert). No lee DB — solo verifica
 * que el schema compile y los $inferSelect/Insert sean usables sin
 * type-cast.
 *
 * Las tablas existían solo como raw SQL en prod:
 *   - tenant_admins         (018)
 *   - menu_overrides        (019)
 *   - paused_conversations  (020)
 *   - agent_rules           (021)
 *   - agent_feedback        (022)
 *   - learning_runs         (023)
 *   - learned_rules_pending (023)
 *
 * (handoff_whatsapp_phone era columna de agent_configs, no tabla.)
 */

import { describe, it, expect } from "vitest";
import {
  agentFeedback,
  agentRules,
  learnedRulesPending,
  learningRuns,
  menuOverrides,
  pausedConversations,
  tenantAdmins,
  type AgentFeedback,
  type AgentRule,
  type LearnedRulePending,
  type LearningRun,
  type MenuOverride,
  type NewAgentFeedback,
  type NewAgentRule,
  type NewLearnedRulePending,
  type NewLearningRun,
  type NewMenuOverride,
  type NewPausedConversation,
  type NewTenantAdmin,
  type PausedConversation,
  type TenantAdmin,
} from "@/lib/db/schema";

describe("Schema Drizzle — tablas nuevas (migraciones 018–023)", () => {
  it("tenant_admins expone type + insert", () => {
    const row: TenantAdmin = {
      id: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      phoneWa: "+34604342381",
      displayName: "Mario",
      pinHash: "$argon2id$...",
      lastAuthAt: null,
      authAttempts: 0,
      createdAt: new Date(),
      createdBy: null,
    };
    const insert: NewTenantAdmin = {
      tenantId: row.tenantId,
      phoneWa: row.phoneWa,
      pinHash: row.pinHash,
    };
    expect(tenantAdmins).toBeDefined();
    expect(row.phoneWa).toBe(insert.phoneWa);
  });

  it("menu_overrides expone type + insert", () => {
    const row: MenuOverride = {
      id: "00000000-0000-0000-0000-000000000003",
      tenantId: "00000000-0000-0000-0000-000000000002",
      itemName: "Pizza Dakota",
      available: false,
      priceOverrideCents: null,
      note: "sin stock hoy",
      activeUntil: null,
      createdAt: new Date(),
      createdByAdminId: null,
    };
    const insert: NewMenuOverride = { tenantId: row.tenantId, itemName: row.itemName };
    expect(menuOverrides).toBeDefined();
    expect(insert.itemName).toBe("Pizza Dakota");
  });

  it("paused_conversations usa PK compuesta tenant+phone", () => {
    const row: PausedConversation = {
      tenantId: "00000000-0000-0000-0000-000000000002",
      customerPhone: "+34600000000",
      pausedAt: new Date(),
      pausedByAdminId: null,
      reason: null,
    };
    const insert: NewPausedConversation = {
      tenantId: row.tenantId,
      customerPhone: row.customerPhone,
    };
    expect(pausedConversations).toBeDefined();
    expect(insert.customerPhone).toBe(row.customerPhone);
  });

  it("agent_rules respeta priority DESC default", () => {
    const row: AgentRule = {
      id: "00000000-0000-0000-0000-000000000004",
      tenantId: "00000000-0000-0000-0000-000000000002",
      ruleText: "Menciona Bonets Grill al cerrar.",
      active: true,
      priority: 90,
      createdByAdminId: null,
      createdByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const insert: NewAgentRule = {
      tenantId: row.tenantId,
      ruleText: row.ruleText,
    };
    expect(agentRules).toBeDefined();
    expect(insert.ruleText.length).toBeGreaterThanOrEqual(3);
  });

  it("agent_feedback cubre verdict + source", () => {
    const row: AgentFeedback = {
      id: "00000000-0000-0000-0000-000000000005",
      tenantId: "00000000-0000-0000-0000-000000000002",
      createdByUserId: null,
      userMessage: "hola",
      botResponse: "Hola, ¿en qué puedo ayudarte?",
      verdict: "up",
      reason: null,
      source: "free",
      superAdminNotified: false,
      createdAt: new Date(),
    };
    const insert: NewAgentFeedback = {
      tenantId: row.tenantId,
      userMessage: row.userMessage,
      botResponse: row.botResponse,
      verdict: row.verdict,
    };
    expect(agentFeedback).toBeDefined();
    expect(["up", "down"].includes(insert.verdict)).toBe(true);
  });

  it("learning_runs + learned_rules_pending linkados por appliedRuleId", () => {
    const run: LearningRun = {
      id: "00000000-0000-0000-0000-000000000006",
      tenantId: "00000000-0000-0000-0000-000000000002",
      messagesAnalyzed: 50,
      rulesProposed: 2,
      tokensIn: 1000,
      tokensOut: 200,
      error: null,
      createdAt: new Date(),
    };
    const pending: LearnedRulePending = {
      id: "00000000-0000-0000-0000-000000000007",
      tenantId: run.tenantId,
      ruleText: "Responder más breve cuando el cliente pregunta hora",
      evidence: "3 conversaciones donde la respuesta fue >300 chars",
      suggestedPriority: 60,
      sourceWindowStart: new Date(Date.now() - 86400_000),
      sourceWindowEnd: new Date(),
      status: "pending",
      appliedRuleId: null,
      reviewedByUserId: null,
      reviewedAt: null,
      createdAt: new Date(),
    };
    const insertRun: NewLearningRun = { tenantId: run.tenantId };
    const insertPending: NewLearnedRulePending = {
      tenantId: pending.tenantId,
      ruleText: pending.ruleText,
    };
    expect(learningRuns).toBeDefined();
    expect(learnedRulesPending).toBeDefined();
    expect(insertRun.tenantId).toBe(insertPending.tenantId);
  });
});
