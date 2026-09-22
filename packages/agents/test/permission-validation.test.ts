import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { flagsForProfile, resolveRunPermissions, validatePermissionSelection } from '../src/permissions.js';

beforeEach(() => vi.stubEnv('AGENTOS_ALLOW_BYPASS', '0'));
afterEach(() => vi.unstubAllEnvs());

describe('permission boundary', () => {
  it('accepts documented permission values for the correct adapter', () => {
    expect(resolveRunPermissions('codex', { permissionFlags: ['--sandbox', 'read-only'] })).toEqual(['--sandbox', 'read-only']);
    expect(resolveRunPermissions('claude', { permissionFlags: ['--permission-mode', 'plan'] })).toEqual(['--permission-mode', 'plan']);
    expect(resolveRunPermissions('gemini', { profile: 'developer' })).toEqual(['--approval-mode', 'auto_edit']);
  });
  it('rejects another adapters parameters and unknown adapter flags', () => {
    expect(() => resolveRunPermissions('codex', { permissionFlags: ['--permission-mode', 'plan'] })).toThrow();
    expect(() => resolveRunPermissions('custom', { permissionFlags: ['--sandbox', 'read-only'] })).toThrow();
  });
  it('gates full profiles and explicit bypass values even without HTTP', () => {
    expect(() => resolveRunPermissions('codex', { profile: 'full' })).toThrow(/full/);
    expect(() => resolveRunPermissions('codex', { permissionFlags: ['--sandbox', 'danger-full-access'] })).toThrow();
    vi.stubEnv('AGENTOS_ALLOW_BYPASS', '1');
    expect(resolveRunPermissions('codex', { profile: 'full' })).toEqual(['--sandbox', 'danger-full-access']);
    expect(() => resolveRunPermissions('codex', { permissionFlags: ['-C', '/outside'] })).toThrow();
  });
  it.each([null, ['__proto__', 'value'], ['--sandbox', 123], ['--sandbox', 'unknown'], ['--allowedTools', '\nBash'], ['--allowedTools', '--other']])('rejects malformed raw flags: %j', flags => {
    expect(() => validatePermissionSelection({ permissionFlags: flags })).toThrow();
  });
  it('returns independent arrays so a caller cannot change future profiles', () => {
    const flags = flagsForProfile('codex', 'developer');
    flags[1] = 'danger-full-access';
    expect(flagsForProfile('codex', 'developer')).toEqual(['--sandbox', 'workspace-write']);
  });
});
