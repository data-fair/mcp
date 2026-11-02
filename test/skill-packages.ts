import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Writes a package directory (relative path -> content) into a fresh temp folder and returns it. */
export const writeSkillPackage = async (files: Record<string, string | Buffer>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'skill-package-'))
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  return dir
}
