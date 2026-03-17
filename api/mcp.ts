import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const CHAT_TOOL = {
  name: "chat",
  description: "Send a prompt to OpenAI and return the model response.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" }
    },
    required: ["prompt"],
    additionalProperties: false
  }
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

function parseBody(body: unknown): JsonRpcRequest {
  if (typeof body === "string") {
    return JSON.parse(body) as JsonRpcRequest;
  }
  return (body ?? {}) as JsonRpcRequest;
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function extractResponseText(response: any): string {
  if (typeof response?.output_text === "string" && response.output_text.length > 0) {
    return response.output_text;
  }

  const outputs = Array.isArray(response?.output) ? response.output : [];
  const textParts: string[] = [];

  for (const output of outputs) {
    const content = Array.isArray(output?.content) ? output.content : [];
    for (const item of content) {
      const text = item?.text;
      if (typeof text === "string" && text.length > 0) {
        textParts.push(text);
      }
    }
  }

  return textParts.join("\n").trim();
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  let payload: JsonRpcRequest;
  try {
    payload = parseBody(req.body);
  } catch {
    res.status(400).json(rpcError(null, -32700, "Parse error"));
    return;
  }

  const id = payload.id ?? null;

  if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string") {
    res.status(400).json(rpcError(id, -32600, "Invalid Request"));
    return;
  }

  if (payload.method === "tools/list") {
    res.status(200).json(
      rpcResult(id, {
        tools: [CHAT_TOOL]
      })
    );
    return;
  }

  if (payload.method === "tools/call") {
    const name = payload.params?.name;
    const args = payload.params?.arguments as Record<string, unknown> | undefined;

    if (name !== "chat") {
      res.status(400).json(rpcError(id, -32601, "Tool not found"));
      return;
    }

    const prompt = args?.prompt;
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      res.status(400).json(rpcError(id, -32602, "Invalid params: prompt must be a non-empty string"));
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json(rpcError(id, -32000, "OPENAI_API_KEY is not configured"));
      return;
    }

    try {
      const response = await client.responses.create({
        model: "gpt-4.1-mini",
        input: prompt
      });

      const text = extractResponseText(response) || "";
      res.status(200).json(
        rpcResult(id, {
          content: [
            {
              type: "text",
              text
            }
          ]
        })
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenAI request failed";
      res.status(500).json(rpcError(id, -32001, message));
      return;
    }
  }

  res.status(400).json(rpcError(id, -32601, "Method not found"));
}
