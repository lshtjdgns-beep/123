import "server-only";

export function hasAiImageKeys(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}

async function generateWithGemini(prompt: string): Promise<Buffer | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data: string } }[] } }[] };
  const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  return data ? Buffer.from(data, "base64") : null;
}

async function generateWithOpenAI(prompt: string): Promise<Buffer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", n: 1 }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  return b64 ? Buffer.from(b64, "base64") : null;
}

/** 사진처럼 보이는 일러스트용 이미지. 글자(간판·메뉴)는 넣지 않게 지시 — 지어낸 정보 방지 */
export async function generateAiImage(subject: string): Promise<{ buffer: Buffer; provider: string } | null> {
  const prompt = `A natural, realistic blog photo of: ${subject}. Soft daylight, shot on a smartphone, no text, no letters, no signage, no watermark.`;
  for (const [name, fn] of [["gemini", generateWithGemini], ["openai", generateWithOpenAI]] as const) {
    try {
      const buf = await fn(prompt);
      if (buf) return { buffer: buf, provider: name };
    } catch (e) {
      console.warn(`[ai-image] ${name} 실패:`, (e as Error).message);
    }
  }
  return null;
}
