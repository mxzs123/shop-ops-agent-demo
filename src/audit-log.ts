import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

export class AuditLog {
  constructor(private readonly filePath: string) {}

  async write(entry: Record<string, unknown>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify({
      ...entry,
      recordedAt: new Date().toISOString(),
    });
    await appendFile(this.filePath, `${line}\n`, "utf8");
  }
}
