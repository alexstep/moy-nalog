import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--silent'], {
  cwd: root,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .at(-1)

if (!packed) {
  throw new Error('npm pack не вернул имя архива')
}

const tarball = join(root, packed)
const dir = mkdtempSync(join(tmpdir(), 'moy-nalog-smoke-'))

try {
  execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' })
  execFileSync('npm', ['install', '--silent', tarball], {
    cwd: dir,
    stdio: 'inherit',
  })

  writeFileSync(
    join(dir, 'cjs.cjs'),
    `
    const NalogAPI = require('moy-nalog')
    if (typeof NalogAPI !== 'function') {
      console.error('require вернул не класс', NalogAPI)
      process.exit(1)
    }
    const api = new NalogAPI({ autologin: false })
    if (api.apiUrl !== 'https://lknpd.nalog.ru/api/v1') process.exit(1)
    if (typeof api.auth !== 'function' || typeof api.addIncome !== 'function' || typeof api.getToken !== 'function') process.exit(1)
    console.log('cjs-ok', api.apiUrl)
  `,
  )
  execFileSync('node', ['cjs.cjs'], { cwd: dir, stdio: 'inherit' })

  writeFileSync(
    join(dir, 'esm.mjs'),
    `
    import NalogAPI from 'moy-nalog'
    if (typeof NalogAPI !== 'function') {
      console.error('import вернул не класс', NalogAPI)
      process.exit(1)
    }
    const api = new NalogAPI({ autologin: false })
    if (typeof api.call !== 'function' || typeof api.userInfo !== 'function') process.exit(1)
    console.log('esm-ok', api.apiUrl)
  `,
  )
  execFileSync('node', ['esm.mjs'], { cwd: dir, stdio: 'inherit' })

  writeFileSync(
    join(dir, 'types.ts'),
    `
    import NalogAPI from 'moy-nalog'
    const api = new NalogAPI({ autologin: false })
    const url: string = api.apiUrl
    void url
  `,
  )
  writeFileSync(
    join(dir, 'types-cjs.cts'),
    `
    import NalogAPI = require('moy-nalog')
    const api = new NalogAPI({ autologin: false })
    const info: Promise<unknown> = api.userInfo()
    void info
  `,
  )
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        strict: true,
        noEmit: true,
        types: [],
      },
      files: ['types.ts', 'types-cjs.cts'],
    }),
  )
  execFileSync(
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    ['-p', 'tsconfig.json'],
    {
      cwd: dir,
      stdio: 'inherit',
    },
  )
  console.log('types-ok')
} finally {
  rmSync(dir, { recursive: true, force: true })
  rmSync(tarball, { force: true })
}
