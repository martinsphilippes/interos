import "server-only";
/**
 * Configurações da operação da Central (settings): motivos de pausa (`central_pausas`), alertas do gerente
 * (`central_alertas`) e política de gravação (`politica_gravacao`). Ausente = padrão (src/domain/central-ops.ts).
 */
import { create, list, update } from "@/server/db";
import { COLLECTIONS, type Settings } from "@/domain/types";
import { DEFAULT_MANAGER_ALERTS, DEFAULT_PAUSE_REASONS, DEFAULT_RECORDING_POLICY, type ManagerAlertsConfig, type PauseReason, type RecordingPolicy } from "@/domain/central-ops";

export const PAUSES_SETTING = "central_pausas";
export const ALERTS_SETTING = "central_alertas";
export const RECORDING_SETTING = "politica_gravacao";

async function read(key: string): Promise<Settings | undefined> {
  return (await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", key]] }))[0];
}

export async function writeSetting(key: string, value: object, description: string): Promise<void> {
  const doc = await read(key);
  const v = value as Record<string, unknown>;
  if (doc) await update<Settings>(COLLECTIONS.settings, doc.id, { value: v });
  else await create<Settings>(COLLECTIONS.settings, { key, value: v, description });
}

export async function getPauseReasons(): Promise<PauseReason[]> {
  const v = (await read(PAUSES_SETTING))?.value as { reasons?: PauseReason[] } | undefined;
  return v?.reasons?.length ? v.reasons : DEFAULT_PAUSE_REASONS;
}

export async function getManagerAlertsConfig(): Promise<ManagerAlertsConfig & { stored: boolean }> {
  const doc = await read(ALERTS_SETTING);
  const v = (doc?.value ?? {}) as Partial<ManagerAlertsConfig>;
  const d = DEFAULT_MANAGER_ALERTS;
  return {
    queue: { ...d.queue, ...v.queue },
    sla: { ...d.sla, ...v.sla },
    idle: { ...d.idle, ...v.idle },
    pause: { ...d.pause, ...v.pause },
    repeatMinutes: v.repeatMinutes ?? d.repeatMinutes,
    stored: Boolean(doc),
  };
}

export async function getRecordingPolicy(): Promise<RecordingPolicy & { stored: boolean }> {
  const doc = await read(RECORDING_SETTING);
  return { ...DEFAULT_RECORDING_POLICY, ...((doc?.value ?? {}) as Partial<RecordingPolicy>), stored: Boolean(doc) };
}
