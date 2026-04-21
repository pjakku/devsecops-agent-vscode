import * as childProcess from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

export type Severity = "critical" | "high" | "medium" | "low" | "info" | "unknown";

export interface Finding {
  id?: string;
  finding_id?: string;
  title: string;
  severity?: string;
  scanner?: string;
  scanner_name?: string;
  category?: string;
  filePath?: string;
  file_path?: string;
  line?: number;
  line_number?: number;
  message?: string;
}

export interface ScanReport {
  findings: Finding[];
}

export class BackendRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendRunnerError";
  }
}

export class BackendRunner {
  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  async scanWorkspace(): Promise<ScanReport> {
    const workspaceFolder = this.getWorkspaceFolder();
    const backendPath = this.resolveBackendExecutablePath();
    await this.ensureBackendExists(backendPath);

    const reportPath = path.join(os.tmpdir(), `devsecops-agent-report-${Date.now()}.json`);
    await this.executeScan(backendPath, workspaceFolder.uri.fsPath, reportPath);

    return this.readReport(reportPath);
  }

  getWorkspaceFolder(): vscode.WorkspaceFolder {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new BackendRunnerError("No workspace is open. Open a folder or workspace before running DevSecOps Agent.");
    }

    return folders[0];
  }

  resolveBackendExecutablePath(): string {
    const executableName = process.platform === "win32" ? "devsecops-agent.exe" : "devsecops-agent";
    return path.join(this.extensionContext.extensionPath, "backend", executableName);
  }

  resolveBundledSemgrepExecutablePath(): string | undefined {
    if (process.platform !== "win32") {
      return undefined;
    }

    return path.join(this.extensionContext.extensionPath, "backend", "semgrep", "win", "semgrep.exe");
  }

  private async ensureBackendExists(backendPath: string): Promise<void> {
    try {
      await fs.access(backendPath);
    } catch {
      throw new BackendRunnerError(
        `DevSecOps Agent backend executable was not found at ${backendPath}. Add the bundled backend executable under the extension backend folder.`
      );
    }
  }

  private executeScan(backendPath: string, workspacePath: string, reportPath: string): Promise<void> {
    const args = ["scan", workspacePath, "--json-out", reportPath];
    const command = formatCommand(backendPath, args);
    const env = this.buildBackendEnvironment();

    return new Promise((resolve, reject) => {
      childProcess.execFile(
        backendPath,
        args,
        {
          cwd: workspacePath,
          env,
          windowsHide: true,
          timeout: 10 * 60 * 1000
        },
        (error, stdout, stderr) => {
          const exitCode = getExitCode(error);
          if (exitCode === 0 || exitCode === 1) {
            resolve();
            return;
          }

          const failureKind = exitCode === 3
            ? "DevSecOps Agent rejected the command or target path."
            : "DevSecOps Agent backend execution failed.";

          reject(
            new BackendRunnerError(
              [
                failureKind,
                `Command: ${command}`,
                `Exit code: ${exitCode}`,
                snippet("stderr", stderr),
                snippet("stdout", stdout),
                error ? `Error: ${error.message}` : undefined
              ]
                .filter(Boolean)
                .join(" ")
            )
          );
        }
      );
    });
  }

  private buildBackendEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const semgrepPath = this.resolveBundledSemgrepExecutablePath();
    if (!semgrepPath) {
      return env;
    }

    env.DEVSECOPS_AGENT_SEMGREP_PATH = semgrepPath;
    env.SEMGREP_PATH = semgrepPath;
    env.PATH = prependPath(path.dirname(semgrepPath), env.PATH);
    return env;
  }

  private async readReport(reportPath: string): Promise<ScanReport> {
    try {
      const raw = await fs.readFile(reportPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return { findings: normalizeFindings(parsed) };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BackendRunnerError(`DevSecOps Agent JSON report could not be read from ${reportPath}. ${detail}`);
    }
  }
}

function normalizeFindings(report: unknown): Finding[] {
  if (Array.isArray(report)) {
    return report.map(normalizeFinding);
  }

  if (isRecord(report) && Array.isArray(report.findings)) {
    return report.findings.map(normalizeFinding);
  }

  return [];
}

function normalizeFinding(value: unknown): Finding {
  if (!isRecord(value)) {
    return { title: "Untitled finding", severity: "unknown" };
  }

  const id = stringValue(value.finding_id) ?? stringValue(value.id);
  const scanner = stringValue(value.scanner_name) ?? stringValue(value.scanner) ?? stringValue(value.tool);
  const filePath =
    stringValue(value.file_path) ?? stringValue(value.filePath) ?? stringValue(value.file) ?? stringValue(value.path);
  const line = numberValue(value.line_number) ?? numberValue(value.line) ?? numberValue(value.startLine);

  return {
    id,
    finding_id: id,
    title: stringValue(value.title) ?? stringValue(value.name) ?? stringValue(value.message) ?? "Untitled finding",
    severity: stringValue(value.severity) ?? "unknown",
    scanner,
    scanner_name: scanner,
    category: stringValue(value.category) ?? stringValue(value.ruleId),
    filePath,
    file_path: filePath,
    line,
    line_number: line,
    message: stringValue(value.message) ?? stringValue(value.description)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function getExitCode(error: childProcess.ExecFileException | null): number {
  if (!error) {
    return 0;
  }

  return typeof error.code === "number" ? error.code : 2;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteArg).join(" ");
}

function quoteArg(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, '\\"')}"`;
}

function snippet(label: string, value: string): string | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }

  return `${label}: ${text.slice(0, 800)}`;
}

function prependPath(entry: string, currentPath: string | undefined): string {
  return currentPath ? `${entry}${path.delimiter}${currentPath}` : entry;
}
