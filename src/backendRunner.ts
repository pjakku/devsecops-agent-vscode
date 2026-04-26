import * as childProcess from "child_process";
import * as fsSync from "fs";
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
  description?: string;
  recommendation?: string;
  filePath?: string;
  file_path?: string;
  line?: number;
  line_number?: number;
  message?: string;
}

export interface ScannerExecution {
  scannerName: string;
  status: string;
  command?: string;
  message?: string;
}

export interface ScanReport {
  findings: Finding[];
  totalFindings: number;
  scannerExecutions: ScannerExecution[];
  reportPath: string;
  backendPath: string;
  semgrepPath?: string;
  gitleaksPath?: string;
  exitCode: number;
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
    const execution = await this.executeScan(backendPath, workspaceFolder.uri.fsPath, reportPath);
    const report = await this.readReport(reportPath);

    return {
      ...report,
      reportPath,
      backendPath,
      semgrepPath: execution.semgrepPath,
      gitleaksPath: execution.gitleaksPath,
      exitCode: execution.exitCode
    };
  }

  getWorkspaceFolder(): vscode.WorkspaceFolder {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new BackendRunnerError("No workspace is open. Open a folder or workspace before running DevSecOps Agent.");
    }

    return folders[0];
  }

  resolveBackendExecutablePath(): string {
    return path.join(this.extensionContext.extensionPath, "backend", this.executableFileName("devsecops-agent"));
  }

  resolveBundledSemgrepExecutablePath(): string | undefined {
    return this.resolveBundledToolExecutablePath("semgrep", "semgrep");
  }

  resolveBundledGitleaksExecutablePath(): string | undefined {
    return this.resolveBundledToolExecutablePath("gitleaks", "gitleaks");
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

  private executeScan(
    backendPath: string,
    workspacePath: string,
    reportPath: string
  ): Promise<{ exitCode: number; semgrepPath?: string; gitleaksPath?: string }> {
    const args = ["scan", workspacePath, "--json-out", reportPath];
    const command = formatCommand(backendPath, args);
    const environment = this.buildBackendEnvironment();

    return new Promise((resolve, reject) => {
      childProcess.execFile(
        backendPath,
        args,
        {
          cwd: workspacePath,
          env: environment.env,
          windowsHide: true,
          timeout: 10 * 60 * 1000
        },
        (error, stdout, stderr) => {
          const exitCode = getExitCode(error);
          if (exitCode === 0 || exitCode === 1) {
            resolve({
              exitCode,
              semgrepPath: environment.semgrepPath,
              gitleaksPath: environment.gitleaksPath
            });
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

  private buildBackendEnvironment(): {
    env: NodeJS.ProcessEnv;
    semgrepPath?: string;
    gitleaksPath?: string;
  } {
    const env = { ...process.env };
    const pathEntries: string[] = [];
    let semgrepPath: string | undefined;
    let gitleaksPath: string | undefined;

    const bundledTools = [
      {
        key: "semgrep",
        executablePath: this.resolveBundledSemgrepExecutablePath(),
        variables: ["DEVSECOPS_AGENT_SEMGREP_PATH", "SEMGREP_PATH"]
      },
      {
        key: "gitleaks",
        executablePath: this.resolveBundledGitleaksExecutablePath(),
        variables: ["DEVSECOPS_AGENT_GITLEAKS_PATH", "GITLEAKS_PATH"]
      }
    ];

    for (const bundledTool of bundledTools) {
      if (!bundledTool.executablePath || !fsSync.existsSync(bundledTool.executablePath)) {
        continue;
      }

      for (const variableName of bundledTool.variables) {
        env[variableName] = bundledTool.executablePath;
      }

      pathEntries.push(path.dirname(bundledTool.executablePath));
      if (bundledTool.key === "semgrep") {
        semgrepPath = bundledTool.executablePath;
      }

      if (bundledTool.key === "gitleaks") {
        gitleaksPath = bundledTool.executablePath;
      }
    }

    env.PATH = prependPaths(pathEntries, env.PATH);
    return { env, semgrepPath, gitleaksPath };
  }

  private resolveBundledToolExecutablePath(toolName: string, executableBaseName: string): string | undefined {
    const platformFolder = this.platformFolderName();
    if (!platformFolder) {
      return undefined;
    }

    return path.join(
      this.extensionContext.extensionPath,
      "backend",
      toolName,
      platformFolder,
      this.executableFileName(executableBaseName)
    );
  }

  private platformFolderName(): "win" | "mac" | "linux" | undefined {
    if (process.platform === "win32") {
      return "win";
    }

    if (process.platform === "darwin") {
      return "mac";
    }

    if (process.platform === "linux") {
      return "linux";
    }

    return undefined;
  }

  private executableFileName(baseName: string): string {
    return process.platform === "win32" ? `${baseName}.exe` : baseName;
  }

  private async readReport(reportPath: string): Promise<Omit<ScanReport, "reportPath" | "backendPath" | "semgrepPath" | "gitleaksPath" | "exitCode">> {
    try {
      const raw = await fs.readFile(reportPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return normalizeReport(parsed);
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

function normalizeReport(
  report: unknown
): Omit<ScanReport, "reportPath" | "backendPath" | "semgrepPath" | "gitleaksPath" | "exitCode"> {
  const findings = normalizeFindings(report);
  if (!isRecord(report)) {
    return {
      findings,
      totalFindings: findings.length,
      scannerExecutions: []
    };
  }

  return {
    findings,
    totalFindings: numberValue(report.total_findings) ?? findings.length,
    scannerExecutions: normalizeScannerExecutions(report.scanner_executions)
  };
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
  const description = stringValue(value.description) ?? stringValue(value.message);
  const recommendation = stringValue(value.recommendation);

  return {
    id,
    finding_id: id,
    title: stringValue(value.title) ?? stringValue(value.name) ?? stringValue(value.message) ?? "Untitled finding",
    severity: stringValue(value.severity) ?? "unknown",
    scanner,
    scanner_name: scanner,
    category: stringValue(value.category) ?? stringValue(value.ruleId),
    description,
    recommendation,
    filePath,
    file_path: filePath,
    line,
    line_number: line,
    message: description
  };
}

function normalizeScannerExecutions(value: unknown): ScannerExecution[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const executions: ScannerExecution[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const scannerName = stringValue(item.scanner_name) ?? stringValue(item.scanner);
    if (!scannerName) {
      continue;
    }

    executions.push({
      scannerName,
      status: stringValue(item.status) ?? "unknown",
      command: stringValue(item.command),
      message: stringValue(item.message)
    });
  }

  return executions;
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

function prependPaths(entries: string[], currentPath: string | undefined): string {
  const uniqueEntries = Array.from(new Set(entries.filter(Boolean)));
  if (uniqueEntries.length === 0) {
    return currentPath ?? "";
  }

  const prefix = uniqueEntries.join(path.delimiter);
  return currentPath ? `${prefix}${path.delimiter}${currentPath}` : prefix;
}
