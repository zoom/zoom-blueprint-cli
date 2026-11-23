import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Writable } from 'node:stream';

const FILE_LIMIT = 2 * 1024 * 1024;
const TAIL_LIMIT = 32 * 1024;
const clean = (text: string) => text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '');

/** Drain both child pipes throughout setup. Disk rotation and diagnostic tails have fixed bounds. */
export class DevOutput {
  readonly file: string;
  private fd: number;
  private size = 0;
  private quiet = true;
  private diagnostics = '';
  private recent = '';
  private pending = '';
  private decoder = new StringDecoder('utf8');
  private closed = false;
  private failedDisk = false;

  constructor(private verbose = false, private stdout: Writable = process.stdout, private stderr: Writable = process.stderr) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoom-dev-'));
    fs.chmodSync(dir, 0o700);
    this.file = path.join(dir, 'runtime.log');
    this.fd = fs.openSync(this.file, 'w', 0o600);
  }

  write(stream: 'stdout' | 'stderr', data: Buffer): Writable | undefined {
    if (this.closed) return;
    // Never let a full disk stop draining the subprocess pipes.
    try {
      for (let offset = 0; offset < data.length;) {
        if (this.size >= FILE_LIMIT) {
          fs.closeSync(this.fd);
          fs.rmSync(this.file + '.previous', { force: true });
          fs.renameSync(this.file, this.file + '.previous');
          this.fd = fs.openSync(this.file, 'w', 0o600);
          this.size = 0;
        }
        const length = Math.min(FILE_LIMIT - this.size, data.length - offset);
        fs.writeSync(this.fd, data, offset, length);
        this.size += length;
        offset += length;
      }
    } catch {
      if (!this.failedDisk) {
        const message = '\nUnable to write runtime log (check available disk space).\n';
        if (this.quiet) this.diagnostics = (this.diagnostics + message).slice(-TAIL_LIMIT);
        else this.stderr.write(message);
      }
      this.failedDisk = true;
    }
    const text = data.toString('utf8');
    this.recent = (this.recent + clean(text)).slice(-TAIL_LIMIT);
    if (stream === 'stderr') {
      if (this.quiet) this.diagnostics = (this.diagnostics + clean(text)).slice(-TAIL_LIMIT);
      else if (!this.stderr.write(data)) return this.stderr;
      return;
    }
    if (!this.quiet && this.verbose) {
      if (!this.stdout.write(data)) return this.stdout;
      return;
    }
    this.pending += this.decoder.write(data);
    // Cap an unterminated line as well as the saved diagnostic tail.
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop()!.slice(-TAIL_LIMIT);
    for (const line of lines) {
      const plain = clean(line);
      if (!/\b(error|fatal|exception|failed|warn(?:ing)?)\b|\b[45]\d\d\b/i.test(plain)) continue;
      if (this.quiet) this.diagnostics = (this.diagnostics + plain + '\n').slice(-TAIL_LIMIT);
      else this.stderr.write(plain + '\n');
    }
    if (!this.quiet && this.stderr.writableNeedDrain) return this.stderr;
  }

  /** Called only after configuration review and every setup prompt have finished. */
  release(): void {
    if (!this.quiet) return;
    this.quiet = false;
    if (this.diagnostics) this.stderr.write('\nApplication diagnostics from setup (recent output)\n' + this.diagnostics + '\n');
    this.diagnostics = '';
  }

  close(failed = false): void {
    if (this.closed) return;
    this.release();
    if (failed && this.recent) this.stderr.write('\nApplication output before failure (recent output)\n' + this.recent + '\n');
    if (this.pending && /error|fatal|exception|failed/i.test(this.pending)) this.stderr.write(clean(this.pending) + '\n');
    this.closed = true;
    try { fs.closeSync(this.fd); } catch { /* Already closed after a disk error. */ }
  }
}
