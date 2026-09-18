/**
 * 最小 JSON-RPC 2.0 NDJSON 帧工具（ACP 传输层，供 acp/client.ts 与测试复用）。
 * ACP：stdio 上的换行分隔 JSON-RPC（docs/research/01-protocols-acp.md）。
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function writeMessage(writable: NodeJS.WritableStream, msg: JsonRpcMessage): void {
  writable.write(JSON.stringify(msg) + '\n');
}

export interface MessageReader {
  /** 返回取消订阅函数 */
  onMessage(cb: (msg: JsonRpcMessage) => void): () => void;
}

export function createMessageReader(readable: NodeJS.ReadableStream): MessageReader {
  let buffer = '';
  const listeners = new Set<(msg: JsonRpcMessage) => void>();
  readable.setEncoding('utf8');
  readable.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        for (const fn of listeners) fn(msg);
      } catch {
        // 坏行忽略（帧层容错）
      }
    }
  });
  return {
    onMessage(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
