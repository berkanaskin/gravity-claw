/**
 * CENTO Orchestrator — Multi-model task orchestration engine
 *
 * CENTO decomposes complex tasks into sub-tasks, routes each to
 * the optimal agent/model, validates results via Cascading Protocol,
 * and reports completion via Telegram.
 */

import OpenAI from "openai";
import type { Config } from "./config.js";

// ── Types ────────────────────────────────────────────────────────

export type TaskPriority = "critical" | "high" | "normal" | "low";
export type TaskStatus = "queued" | "running" | "validating" | "done" | "failed" | "stuck";
export type AgentRole = "orchestrator" | "coder" | "reviewer" | "researcher" | "scraper";

export interface SubTask {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  role: AgentRole;
  priority: TaskPriority;
  status: TaskStatus;
  expectedInput: string;
  expectedOutput: string;
  actualOutput: string | null;
  validation: ValidationResult | null;
  startedAt: number | null;
  completedAt: number | null;
  retries: number;
  maxRetries: number;
}

export interface CentoTask {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  subTasks: SubTask[];
  createdAt: number;
  completedAt: number | null;
  result: string | null;
}

export interface ValidationResult {
  passed: boolean;
  reason: string;
  confidence: number; // 0-1
}

// ── Agent Model Mapping ──────────────────────────────────────────

export interface AgentModel {
  role: AgentRole;
  model: string;
  provider: "openai" | "gemini" | "antigravity";
  description: string;
  available: () => boolean;
}

// ── Orchestrator Class ───────────────────────────────────────────

export class CentoOrchestrator {
  private readonly openai: OpenAI | null = null;
  private readonly taskQueue: CentoTask[] = [];
  private readonly activeTasks: Map<string, CentoTask> = new Map();
  private readonly config: Config;
  private sendTelegram: ((msg: string) => Promise<void>) | null = null;

  constructor(config: Config) {
    this.config = config;

    if (config.openaiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    }
  }

  /** Register Telegram notification callback */
  onNotify(callback: (msg: string) => Promise<void>) {
    this.sendTelegram = callback;
  }

  /** Available agent models based on current config */
  getAgentModels(): AgentModel[] {
    return [
      {
        role: "orchestrator",
        model: this.config.orchestratorModel,
        provider: "openai",
        description: "CENTO beyin — görev analizi, decomposition, validation",
        available: () => !!this.config.openaiApiKey,
      },
      {
        role: "coder",
        model: "claude-opus-4.6",
        provider: "antigravity",
        description: "Brutal coding — Antigravity UI automation ile",
        available: () => this.config.enablePcBridge,
      },
      {
        role: "reviewer",
        model: "gemini-2.5-pro",
        provider: "gemini",
        description: "Code review — Free tier",
        available: () => !!this.config.modelApiKey,
      },
      {
        role: "researcher",
        model: "gemini-2.5-flash",
        provider: "gemini",
        description: "Web araştırma — hızlı toplama + Pro ile derin analiz",
        available: () => !!this.config.modelApiKey,
      },
      {
        role: "scraper",
        model: "scrapling",
        provider: "antigravity",
        description: "Web scraping — Scrapling + Gemini Flash",
        available: () => this.config.enablePcBridge,
      },
    ];
  }

  // ── Task Decomposition (Cascading Protocol) ──────────────────

  /**
   * Decompose a high-level goal into validated sub-tasks.
   * Uses GPT to analyze the task and create a structured plan.
   */
  async decompose(title: string, description: string, priority: TaskPriority = "normal"): Promise<CentoTask> {
    if (!this.openai) throw new Error("CENTO: OpenAI API key not configured");

    const taskId = `task_${Date.now()}`;
    const availableRoles = this.getAgentModels()
      .filter((a) => a.available())
      .map((a) => `${a.role}: ${a.description} (${a.model})`)
      .join("\n");

    const response = await this.openai.chat.completions.create({
      model: this.config.orchestratorModel,
      messages: [
        {
          role: "system",
          content: `Sen CENTO — bir AI orchestrator'sün. Görevi alt görevlere böl.

Kullanılabilir agent'lar:
${availableRoles}

Kurallar (Cascading Protocol):
1. Her alt görev için expected_input ve expected_output tanımla
2. Alt görevler sıralı olmalı — önceki görev tamamlanmadan sonraki başlamaz
3. Her alt görev bağımsız doğrulanabilir olmalı
4. Başarısızlık durumunda retry stratejisi belirle

JSON formatında yanıt ver:
{
  "subtasks": [
    {
      "title": "string",
      "description": "string",
      "role": "coder|reviewer|researcher|scraper",
      "expected_input": "string",
      "expected_output": "string",
      "max_retries": number
    }
  ]
}`,
        },
        {
          role: "user",
          content: `Görev: ${title}\n\nDetay: ${description}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("CENTO: Empty response from orchestrator model");

    let parsed: { subtasks: Array<{ title: string; description: string; role: AgentRole; expected_input: string; expected_output: string; max_retries?: number }> };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`CENTO: Failed to parse decomposition: ${content.substring(0, 200)}`);
    }

    const subTasks: SubTask[] = (parsed.subtasks || []).map((st, i) => ({
      id: `${taskId}_sub_${i}`,
      parentId: taskId,
      title: st.title,
      description: st.description,
      role: st.role,
      priority,
      status: "queued" as TaskStatus,
      expectedInput: st.expected_input,
      expectedOutput: st.expected_output,
      actualOutput: null,
      validation: null,
      startedAt: null,
      completedAt: null,
      retries: 0,
      maxRetries: st.max_retries ?? 2,
    }));

    const task: CentoTask = {
      id: taskId,
      title,
      description,
      priority,
      status: "queued",
      subTasks: subTasks,
      createdAt: Date.now(),
      completedAt: null,
      result: null,
    };

    this.activeTasks.set(taskId, task);
    return task;
  }

  // ── Validation Gate (Cascading Protocol) ─────────────────────

  /**
   * Validate a sub-task's output against expected output.
   * Uses CENTO brain to judge quality.
   */
  async validate(subTask: SubTask): Promise<ValidationResult> {
    if (!this.openai) return { passed: true, reason: "No validator available", confidence: 0.5 };

    const response = await this.openai.chat.completions.create({
      model: this.config.orchestratorModel,
      messages: [
        {
          role: "system",
          content: `Sen bir QA validator'sün. Bir alt görevin çıktısını beklenen çıktıyla karşılaştır.

JSON yanıt ver:
{
  "passed": boolean,
  "reason": "string — neden geçti/kaldı",
  "confidence": 0.0-1.0
}`,
        },
        {
          role: "user",
          content: `Görev: ${subTask.title}
Açıklama: ${subTask.description}
Beklenen çıktı: ${subTask.expectedOutput}
Gerçek çıktı: ${subTask.actualOutput || "(boş)"}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { passed: false, reason: "Empty validation response", confidence: 0 };

    try {
      return JSON.parse(content) as ValidationResult;
    } catch {
      return { passed: false, reason: `Parse error: ${content.substring(0, 100)}`, confidence: 0 };
    }
  }

  // ── Ralph Loop — Health Check ────────────────────────────────

  /**
   * Ralph Loop: called every 10 minutes by scheduler.
   * Checks active tasks for stuck agents and takes corrective action.
   */
  async ralphLoop(): Promise<string> {
    if (this.activeTasks.size === 0) return "CENTO: Aktif görev yok.";

    const report: string[] = ["🔄 **CENTO Ralph Loop Report**\n"];
    const now = Date.now();
    const STUCK_THRESHOLD = 15 * 60 * 1000; // 15 minutes

    for (const [taskId, task] of this.activeTasks) {
      if (task.status === "done" || task.status === "failed") continue;

      const runningSubTasks = task.subTasks.filter((st) => st.status === "running");

      for (const st of runningSubTasks) {
        if (st.startedAt && now - st.startedAt > STUCK_THRESHOLD) {
          st.status = "stuck";
          report.push(`⚠️ **Takılan görev:** ${st.title} (${Math.round((now - st.startedAt) / 60000)}dk)`);

          // Strategy: retry or escalate
          if (st.retries < st.maxRetries) {
            st.retries++;
            st.status = "queued";
            st.startedAt = null;
            report.push(`   ↳ Retry ${st.retries}/${st.maxRetries}`);
          } else {
            st.status = "failed";
            report.push(`   ↳ Max retry aşıldı, görev başarısız.`);
          }
        }
      }

      // Check if all subtasks are done
      const allDone = task.subTasks.every((st) => st.status === "done");
      const anyFailed = task.subTasks.some((st) => st.status === "failed");

      if (allDone) {
        task.status = "done";
        task.completedAt = Date.now();
        report.push(`✅ **Tamamlandı:** ${task.title}`);
        this.activeTasks.delete(taskId);
      } else if (anyFailed) {
        task.status = "failed";
        report.push(`❌ **Başarısız:** ${task.title}`);
      }
    }

    const reportText = report.length > 1 ? report.join("\n") : "CENTO: Tüm görevler yolunda.";

    // Send important updates via Telegram
    if (report.length > 1 && this.sendTelegram) {
      await this.sendTelegram(reportText);
    }

    return reportText;
  }

  // ── Status ───────────────────────────────────────────────────

  getStatus(): {
    activeTasks: number;
    queuedTasks: number;
    completedToday: number;
    orchestratorModel: string;
    availableAgents: string[];
  } {
    return {
      activeTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length,
      completedToday: 0,
      orchestratorModel: this.config.orchestratorModel,
      availableAgents: this.getAgentModels()
        .filter((a) => a.available())
        .map((a) => `${a.role} (${a.model})`),
    };
  }
}
