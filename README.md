# DevSecOps Agent VS Code Extension

This repository contains the `devsecops-agent-vscode` VS Code extension. It is intentionally separate from the backend repository and does not duplicate scanning logic in TypeScript.

The extension exposes:

- `DevSecOps Agent: Scan Workspace`
- `DevSecOps Agent: Refresh Results`
- `DevSecOps Agent: Show Only SAST Findings`
- `DevSecOps Agent: Show All Findings`
- `DevSecOps Agent: Show Only Secrets Findings`
- `DevSecOps Agent: Show Only Script Findings`
- `DevSecOps Agent: Show Only Kubernetes/Manifest Findings`
- `DevSecOps Agent: Show Only Config Findings`
- `DevSecOps Agent: Show Only Dependency Findings`
- A native sidebar Tree View named `DevSecOps Agent`

Workspace scans are run through the bundled `devsecops-agent` backend. Results are shown in the Explorer Tree View, grouped by severity. Clicking a finding opens the referenced file and navigates to the finding line when one is available.

The `DevSecOps Agent` results view appears in the Explorer sidebar.

The extension runs the bundled `devsecops-agent` backend. Internal findings come from the built-in agent scanners, and SAST findings are powered by Semgrep when available.

Current filters:

- All
- SAST
- Secrets
- Script
- Kubernetes/Manifest
- Config
- Dependency

Before the first scan, the empty `DevSecOps Agent` view shows a simple Run Scan welcome action. After a scan completes, the tree shows a filter status row, an `Actions` group, a `Filters` group with counts, a `Scanner Status` group, and then the severity-grouped findings. The view title toolbar keeps Scan Workspace, Refresh Results, and Show All Findings visible, while the less common filters can appear in the overflow menu depending on sidebar width.

## Prerequisites For Extension Development

- Visual Studio Code
- Node.js and npm
- Extension dependencies installed with:

```powershell
npm.cmd install
```

On Windows, the VS Code tasks use `npm.cmd` so PowerShell execution policy does not block `npm.ps1`. If you run npm commands manually in PowerShell and see an execution policy error, use `npm.cmd` instead of `npm`.

## Backend Executable Structure

The UI does not launch the backend directly. Backend execution is isolated in:

```text
src/backendRunner.ts
```

For the MVP, the runner expects a future bundled executable under:

```text
backend/devsecops-agent.exe
```

On Windows, bundled external scanners can live at:

```text
backend/semgrep/win/semgrep.exe
backend/gitleaks/win/gitleaks.exe
```

Planned future layout:

```text
backend/devsecops-agent
backend/semgrep/mac/semgrep
backend/semgrep/linux/semgrep
backend/gitleaks/mac/gitleaks
backend/gitleaks/linux/gitleaks
```

The backend runner currently prepares a temp JSON report path and executes:

```text
devsecops-agent scan <workspacePath> --json-out <tempReportPath>
```

After execution, it reads the generated JSON report and normalizes findings for the Tree View.

Backend exit code `1` means the scan completed and violated the backend fail threshold. The extension treats exit codes `0` and `1` as completed scans and loads the JSON report in both cases.

When bundled Semgrep or Gitleaks executables are present, the extension passes their paths to the backend through the scan process environment and prepends their folders to the child process `PATH`. This lets SAST and secret scanning run from the extension package without requiring users to install those tools separately.

Troubleshooting:

- Confirm bundled Gitleaks exists at `backend/gitleaks/win/gitleaks.exe`
- Confirm bundled Semgrep exists at `backend/semgrep/win/semgrep.exe`
- Open the `DevSecOps Agent` output channel to see:
  - backend executable path
  - JSON report path
  - Semgrep path used
  - Gitleaks path used
  - backend exit code
  - scanner execution statuses

## Where To Change Backend Path Resolution Later

Change backend path resolution in:

```text
src/backendRunner.ts
```

Specifically, update `resolveBackendExecutablePath()` if packaged backend files later need platform-specific folders, architecture-specific names, signed binaries, or a different layout.

## Extension Structure

```text
package.json              VS Code manifest, commands, Tree View contributions
tsconfig.json             TypeScript compiler settings
resources/                Extension activity bar icon
src/extension.ts          Extension activation, commands, and editor navigation
src/backendRunner.ts      Workspace detection, backend/tool path resolution, execution, JSON loading
src/findingsProvider.ts   Native Tree View provider, grouping, and filter logic
backend/                  Future bundled backend executable location
backend/semgrep/win/      Future bundled Windows Semgrep executable location
backend/gitleaks/win/     Future bundled Windows Gitleaks executable location
```

## Run In Extension Development Host

1. Open this folder in VS Code.
2. Run `npm.cmd install` on Windows PowerShell, or `npm install` on macOS/Linux.
3. Run `npm.cmd run compile` on Windows PowerShell, or `npm run compile` on macOS/Linux.
4. Press `F5`.
5. In the Extension Development Host window, open a sample vulnerable workspace.
6. Use the `DevSecOps Agent` view welcome actions, tree action items, or toolbar to run a workspace scan.

For watch mode during development, run:

```powershell
npm.cmd run watch
```

Then press `F5`.

## Test With A Sample Vulnerable Workspace

Use a workspace that contains a mix of:

- source files with insecure patterns
- secrets-like files such as `.env`
- scripts
- Kubernetes manifests
- configuration files
- dependency manifests

Then:

1. Run `DevSecOps Agent: Scan Workspace`.
2. Confirm results appear in the Explorer Tree View.
3. Click individual findings to verify file navigation.
4. Use the tree `Filters` group or the view title toolbar/overflow to switch between All, SAST, Secrets, Script, Kubernetes/Manifest, Config, and Dependency views.
5. Open the `DevSecOps Agent` output channel to confirm which scanners ran or were skipped.

## Future Features

The MVP leaves room for:

- Severity filtering in the Tree View
- Scan current file
- Jenkins and GitHub Actions references
- Marketplace packaging and publishing
