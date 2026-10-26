import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query, type Options, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// 인증은 의도적으로 apiKey를 넘기지 않는다. SDK가 로컬 claude CLI를 서브프로세스로
// 띄우고, 그 프로세스는 `npx @anthropic-ai/claude-code login`으로 만든 OAuth(구독)
// 자격을 쓴다(토큰 과금 아님).

export class ClaudeAuthError extends Error {
  constructor(message = "Claude 로그인이 풀려 있습니다. 터미널에서 `npx @anthropic-ai/claude-code login`을 실행해 다시 로그인해주세요.") {
    super(message);
    this.name = "ClaudeAuthError";
  }
}

function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

function readOauth(): { accessToken?: string; refreshToken?: string; expiresAt?: number } | null {
  try {
    const raw = fs.readFileSync(path.join(claudeConfigDir(), ".credentials.json"), "utf-8");
    return JSON.parse(raw)?.claudeAiOauth ?? null;
  } catch {
    return null;
  }
}

function hasSubscriptionLogin(): boolean {
  const oauth = readOauth();
  return Boolean(oauth?.accessToken || oauth?.refreshToken);
}

// ⚠ 실제 사고: .env.local에 남아 있던 무효한 ANTHROPIC_API_KEY가 Next를 통해
// process.env로 로드되고 서브프로세스에 상속됐다. CLI는 API 키를 우선하므로 구독
// 로그인이 멀쩡한데도 매 호출마다 ~3분 재시도 후 실패했다.
// → 구독 로그인이 있으면 서브프로세스 환경에서 API 키를 제거한다.
function claudeSubprocessEnv(): Record<string, string | undefined> | undefined {
  if (!process.env.ANTHROPIC_API_KEY || !hasSubscriptionLogin()) return undefined; // 정상 상황, 손대지 않음
  // SDK의 env 옵션은 process.env를 "통째로 대체"하므로 스프레드 후 삭제
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

/**
 * 네트워크 호출 없이 로컬 자격 파일만 보고 즉시 판단.
 * 파이프라인 시작 시 / 설정 페이지 "인증 상태 확인"에서 사용.
 * (이게 없으면 로그인이 풀린 채로 사진 25장짜리 실행이 전부 실패할 때까지 수십 분을 날린다)
 */
export function checkClaudeCredentialsLocal(): { ok: boolean; message: string; apiKeyIgnored: boolean } {
  const apiKeyIgnored = Boolean(process.env.ANTHROPIC_API_KEY) && hasSubscriptionLogin();
  if (hasSubscriptionLogin()) {
    return { ok: true, message: "Claude 구독 로그인이 확인되었습니다.", apiKeyIgnored };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { ok: true, message: "구독 로그인은 없고 ANTHROPIC_API_KEY로 인증합니다(토큰 과금).", apiKeyIgnored: false };
  }
  return { ok: false, message: new ClaudeAuthError().message, apiKeyIgnored: false };
}

export type GenerateOptions = {
  systemPrompt?: string;
  model?: string;
  /** 짧고 독립적인 호출(사진 설명, 말투 요약, 공략법 구조화)용 */
  lightweight?: boolean;
  abortController?: AbortController;
};

function buildQueryOptions(options: GenerateOptions = {}): Options {
  const base: Options = {
    // 글쓰기 전용 — 파일/셸 도구는 전부 끈다
    tools: [],
    maxTurns: 1,
    permissionMode: "default",
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.abortController ? { abortController: options.abortController } : {}),
  };
  // 코딩 세션용 기본값(깊은 사고, 프로젝트 설정파일 전체 로딩)은 단순 작업을 느리게 한다
  const light: Partial<Options> = options.lightweight
    ? { thinking: { type: "disabled" }, effort: "low", settingSources: [], persistSession: false }
    : { settingSources: [], persistSession: false };
  const env = claudeSubprocessEnv();
  return { ...base, ...light, ...(env ? { env } : {}) };
}

async function consumeQueryResult(q: AsyncIterable<SDKMessage>): Promise<string> {
  let assistantText = "";
  for await (const message of q) {
    if (message.type === "assistant") {
      if (message.error === "authentication_failed") throw new ClaudeAuthError();
      if (message.error) throw new Error(`Claude 오류: ${message.error}`);
      for (const block of message.message.content) {
        if (block.type === "text") assistantText += block.text;
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") return message.result || assistantText;
      throw new Error(`Claude 호출 실패 (${message.subtype})${"errors" in message && message.errors?.length ? `: ${message.errors.join("; ")}` : ""}`);
    }
  }
  return assistantText;
}

export async function generateText(prompt: string, options: GenerateOptions = {}): Promise<string> {
  return consumeQueryResult(query({ prompt, options: buildQueryOptions(options) }));
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export async function generateFromImage(
  image: { base64: string; mediaType: ImageMediaType },
  prompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  async function* singleImagePrompt(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: prompt },
        ],
      },
      parent_tool_use_id: null,
    };
  }
  return consumeQueryResult(query({ prompt: singleImagePrompt(), options: buildQueryOptions(options) }));
}

/** 모델 응답에서 첫 JSON 객체/배열을 꺼낸다(```json 펜스, 앞뒤 설명문 허용) */
export function extractJson<T = unknown>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("응답에서 JSON을 찾지 못했습니다.");
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(candidate.slice(start, i + 1)) as T;
  }
  throw new Error("응답의 JSON이 완결되지 않았습니다.");
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 시간 초과(${Math.round(ms / 1000)}초)`)), ms);
    }),
  ]);
}
