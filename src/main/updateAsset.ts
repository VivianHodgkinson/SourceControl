/**
 * Which release file a non-self-updating install should download, and how to install it.
 * Names follow electron-builder's artifact naming for our artifactName pattern
 * (${productName}-${version}-${os}-${arch}.${ext}); see builder-util getArtifactArchName.
 */

export type InstallKind = 'deb' | 'rpm' | 'pacman' | 'tar.gz' | 'portable'

const ARCH_NAMES: Record<InstallKind, Partial<Record<string, string>>> = {
  deb: { x64: 'amd64', arm64: 'arm64' },
  rpm: { x64: 'x86_64', arm64: 'aarch64' },
  pacman: { x64: 'x64', arm64: 'aarch64' },
  'tar.gz': { x64: 'x64', arm64: 'arm64' },
  portable: { x64: 'x64' }
}

/** The release file name for this kind of install on this CPU, or null if we don't build one. */
export function assetName(kind: InstallKind, arch: string, version: string): string | null {
  const a = ARCH_NAMES[kind][arch]
  if (!a) return null
  if (kind === 'portable') return `Verdigit-${version}-portable-${a}.exe`
  return `Verdigit-${version}-linux-${a}.${kind}`
}

/** A command the user can paste to install a downloaded package, if there is one. */
export function installCommand(kind: InstallKind, file: string, opts: { zypper?: boolean } = {}): string | null {
  const q = `"${file.replace(/"/g, '\\"')}"`
  switch (kind) {
    case 'deb':
      return `sudo apt install ${q}`
    case 'rpm':
      return opts.zypper ? `sudo zypper install ${q}` : `sudo dnf install ${q}`
    case 'pacman':
      return `sudo pacman -U ${q}`
    default:
      return null
  }
}
