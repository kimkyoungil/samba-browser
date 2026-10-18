import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'

// 코드 판(커밋 짧은 해시·날짜) — 기기 목록의 버전 옆에 보여, PC 마다 어느 판을 돌리는지 견줄 수 있다.
// 개발 모드는 앱을 띄운 시점의 값이다. git 이 없으면 'unknown'
function appRev(): string {
  try {
    return execSync('git log -1 --format=%h.%cd --date=format:%m%d-%H%M', {
      encoding: 'utf8'
    }).trim()
  } catch {
    return 'unknown'
  }
}

// 로그인 화면에 보일 빌드 정보 — 코드 판(최종 커밋 해시·날짜)과 빌드 시각. 소스에 커밋 안 된 변경이 있으면 판 끝에 '+' 를 붙인다
function appBuildInfo(): { rev: string; built: string } {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const d = new Date()
  const built = `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  let dirty = ''
  try {
    dirty = execSync('git status --porcelain -- src', { encoding: 'utf8' }).trim() ? '+' : ''
  } catch {
    dirty = ''
  }
  return { rev: `${appRev()}${dirty}`, built }
}
const BUILD_INFO = appBuildInfo()

/**
 * 프리로드 공용 모듈 복제 플러그인.
 * 프리로드(page.js·extension-sw.js)는 sandbox 로 주입돼 다른 파일을 require() 할 수 없다. 두 엔트리가 같은 모듈
 * (preload/chrome-shim.ts)을 import 하면 Rollup 이 out/preload/chunks/ 로 쪼개 두 프리로드가 통째로 죽는다
 * (실기 2026-10-18: "module not found: ./chunks/chrome-shim-….js"). 가져오는 엔트리마다 모듈 id 에 쿼리를 붙여
 * 서로 다른 모듈로 보이게 하면 각 번들 안에 복제돼 청크가 생기지 않는다. tests/preload-bundle.test.ts 가 지킨다
 */
function duplicateSharedPreloadModules(): import('vite').Plugin {
  // import 지정자는 './chrome-shim' 꼴이라 파일 이름만 본다
  const SHARED = /(^|[\\/])chrome-shim(\.ts)?$/
  return {
    name: 'samba-duplicate-shared-preload-modules',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || !SHARED.test(source)) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      if (!resolved) return null
      const tag = importer.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'x'
      return `${resolved.id}?dup=${tag}`
    }
  }
}

export default defineConfig({
  main: {
    // .env 의 SAMBA_* 값(Supabase URL·anon 키)을 메인 번들에 주입한다
    envPrefix: ['MAIN_VITE_', 'SAMBA_'],
    define: { __APP_REV__: JSON.stringify(appRev()) },
    build: {
      rollupOptions: {
        // 네이티브 바이너리(.node/.dll)를 품고 있어 번들할 수 없다 — 런타임 require 로 남긴다
        external: ['onnxruntime-node']
      }
    }
  },
  preload: {
    plugins: [duplicateSharedPreloadModules()],
    build: {
      rollupOptions: {
        input: {
          renderer: resolve('src/preload/renderer.ts'),
          page: resolve('src/preload/page.ts'),
          // 확장 서비스워커 보충(chrome.cookies)
          'extension-sw': resolve('src/preload/extension-sw.ts')
        }
      }
    }
  },
  renderer: {
    define: {
      __APP_REV__: JSON.stringify(BUILD_INFO.rev),
      __APP_BUILT__: JSON.stringify(BUILD_INFO.built)
    },
    build: {
      rollupOptions: {
        // 다중 페이지: 앱 UI(index)와 자체 새 탭 페이지(newtab, samba:// 로 서빙)
        input: {
          index: resolve('src/renderer/index.html'),
          newtab: resolve('src/renderer/newtab.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
