import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const skill = readFileSync(join(import.meta.dir, '../../skills/monid/SKILL.md'), 'utf-8');

function section(heading: string): string {
  const start = skill.indexOf(`### ${heading}`);
  expect(start).toBeGreaterThan(-1);
  const next = skill.indexOf('\n### ', start + 1);
  return skill.slice(start, next === -1 ? undefined : next);
}

describe('skill install docs', () => {
  it('documents installing without npm', () => {
    const doc = section('Installing without npm');
    expect(doc).toContain('pnpm add -g @monid-ai/cli');
    expect(doc).toContain('registry.npmjs.org/@monid-ai/cli/latest');
    expect(doc).toContain('dist/index.js');
    expect(doc).toContain('Node.js 20');
  });

  it('links the npm install step to the non-npm path', () => {
    const setup = skill.slice(skill.indexOf('## Setup'), skill.indexOf('### Authentication'));
    expect(setup).toContain('npm install -g @monid-ai/cli@latest');
    expect(setup).toContain('Installing without npm');
    expect(skill).toContain('](#installing-without-npm)');
  });

  it('explains a monid command that is not found after install', () => {
    const doc = section('If `monid` is "not found" after installing');
    expect(doc).toContain('npm prefix -g');
    expect(doc).toContain('%APPDATA%');
    expect(doc).toContain('Restart');
    expect(doc).toContain('where monid');
    expect(doc).toContain('npm config set prefix');
  });

});
