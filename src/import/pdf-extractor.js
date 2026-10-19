import { execFile as execFileCallback } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

async function defaultRunCommand(command, args) {
  const { stdout } = await execFile(command, args, { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

/**
 * @param {{pdfPath: string, textPath: string, runCommand?: (command: string, args: string[]) => Promise<string>}} options
 * @returns {Promise<{textPath: string, pageCount: number, text: string, extractionStatus: string}>}
 */
export async function extractPdfText({ pdfPath, textPath, runCommand = defaultRunCommand }) {
  if (!path.resolve(pdfPath).toLocaleLowerCase('de').endsWith('.pdf')) {
    throw new Error(`Not a PDF path: ${pdfPath}`);
  }
  await fs.access(pdfPath);

  const info = await runCommand('pdfinfo', [pdfPath]);
  const pageMatch = info.match(/^Pages:\s*(\d+)\s*$/m);
  if (!pageMatch) throw new Error(`pdfinfo did not report a page count: ${pdfPath}`);
  const text = await runCommand('pdftotext', ['-layout', pdfPath, '-']);

  const temporaryPath = `${textPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, text, { encoding: 'utf8', flag: 'wx' });
    try {
      await fs.link(temporaryPath, textPath);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }

  return {
    textPath,
    pageCount: Number(pageMatch[1]),
    text,
    extractionStatus: 'success',
  };
}
