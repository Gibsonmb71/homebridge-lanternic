import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withTimeout } from '../util/async.js';
import type { CandidateDevice } from '../ble/lanternBleTransport.js';

export interface SwiftDaemonRequest {
  id?: string;
  cmd: string;
  device?: string;
  frame?: string;
  frames?: string[];
  value?: boolean;
  red?: number;
  green?: number;
  blue?: number;
  brightness?: number;
  speed?: number;
  effectCode?: number;
  timeoutMs?: number;
  namePrefixes?: string[];
  serviceUuids?: string[];
  minRssi?: number;
  serviceUuid?: string;
  characteristicUuid?: string;
  writeWithoutResponse?: boolean;
}

export interface SwiftDaemonResponse {
  id?: string;
  ok: boolean;
  event?: string;
  message?: string;
  frame?: string;
  frames?: string[];
  candidates?: CandidateDevice[];
  backend?: string;
}

export interface SwiftDaemonClientOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (response: SwiftDaemonResponse) => void;
  reject: (error: Error) => void;
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRootCandidates = [
  resolve(moduleDirectory, '../..'),
  resolve(moduleDirectory, '../../..'),
];
const repositoryRoot = repositoryRootCandidates.find(candidate => existsSync(resolve(candidate, 'package.json')))
  ?? repositoryRootCandidates[1];

export const defaultSwiftPackagePath = resolve(repositoryRoot, 'swift/LanternICDaemon');

export class SwiftDaemonClient {
  private process?: ChildProcessWithoutNullStreams;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private nextRequestId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private handleOutOfBandResponse: ((response: SwiftDaemonResponse) => boolean) | undefined;

  constructor(private readonly options: SwiftDaemonClientOptions = {}) {}

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    const command = this.options.command ?? 'swift';
    const args = this.options.args ?? [
      'run',
      '--package-path',
      defaultSwiftPackagePath,
      'lanternicd',
    ];

    const daemon = spawn(command, args, {
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process = daemon;
    daemon.stdout.setEncoding('utf8');
    daemon.stderr.setEncoding('utf8');

    daemon.stdout.on('data', chunk => {
      this.handleStdout(String(chunk));
    });

    daemon.stderr.on('data', chunk => {
      this.stderrBuffer += String(chunk);
    });

    daemon.once('error', error => {
      this.rejectPending(error);
      this.process = undefined;
    });

    daemon.once('exit', (code, signal) => {
      this.rejectPending(new Error(`Swift daemon exited code=${code ?? 'null'} signal=${signal ?? 'null'}`));
      this.process = undefined;
    });

    try {
      await withTimeout(
        this.waitForReady(),
        this.options.startupTimeoutMs ?? 30_000,
        `Timed out waiting for Swift daemon to start${this.stderrBuffer ? `: ${this.stderrBuffer}` : ''}`,
      );
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async request(request: Omit<SwiftDaemonRequest, 'id'> & { id?: string }): Promise<SwiftDaemonResponse> {
    await this.start();

    if (!this.process) {
      throw new Error('Swift daemon is not running');
    }

    const id = request.id ?? String(this.nextRequestId++);
    const payload: SwiftDaemonRequest = { ...request, id };

    const responsePromise = new Promise<SwiftDaemonResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.process.stdin.write(`${JSON.stringify(payload)}\n`);

    try {
      return await withTimeout(
        responsePromise,
        this.options.requestTimeoutMs ?? 10_000,
        `Timed out waiting for Swift daemon response to ${payload.cmd}`,
      );
    } finally {
      this.pending.delete(id);
    }
  }

  async stop(): Promise<void> {
    const daemon = this.process;

    if (!daemon) {
      return;
    }

    this.process = undefined;
    daemon.stdin.end();
    daemon.kill();
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const readyId = `ready-${this.nextRequestId++}`;

      this.pending.set(readyId, {
        resolve: () => resolve(),
        reject,
      });

      this.handleOutOfBandResponse = (response: SwiftDaemonResponse): boolean => {
        if (response.event !== 'ready') {
          return false;
        }

        const pending = this.pending.get(readyId);
        this.pending.delete(readyId);
        pending?.resolve(response);
        return true;
      };
    });
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');

      if (newlineIndex === -1) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let response: SwiftDaemonResponse;

    try {
      response = JSON.parse(line) as SwiftDaemonResponse;
    } catch {
      this.rejectPending(new Error(`Swift daemon emitted invalid JSON: ${line}`));
      return;
    }

    if (this.handleOutOfBandResponse?.(response)) {
      this.handleOutOfBandResponse = undefined;
      return;
    }

    if (!response.id) {
      return;
    }

    const pending = this.pending.get(response.id);

    if (!pending) {
      return;
    }

    this.pending.delete(response.id);

    if (response.ok) {
      pending.resolve(response);
      return;
    }

    pending.reject(new Error(response.message ?? `Swift daemon command failed: ${response.event ?? 'unknown error'}`));
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }

    this.pending.clear();
  }
}
