// adb 실행기. child_process 를 쓰는 파일은 이 하나뿐이고,
// 그 위의 모든 모듈은 AdbRunner 인터페이스만 본다(테스트는 가짜 구현을 쓴다)

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface AdbResult {
  code: number
  stdout: string
  stderr: string
}

/** 오래 도는 외부 프로세스를 띄우는 능력(screenrecord·scrcpy). 종료 함수를 돌려준다 */
export type ProcessSpawner = (
  args: string[],
  onData: (chunk: Buffer) => void,
  onEnd: (code: number | null) => void
) => () => void

export interface AdbRunner {
  // adb 인자 배열을 그대로 실행한다(serial 지정은 호출부가 -s 로 붙인다)
  run: (args: string[], timeoutMs?: number) => Promise<AdbResult>
  // stdout 을 바이너리로 그대로 받는 실행(screencap·screenrecord)
  runBinary: (args: string[], timeoutMs?: number) => Promise<Buffer>
  // 오래 도는 스트림(screenrecord). 종료 함수를 돌려준다
  stream: ProcessSpawner
}

// 한 번짜리 명령 기본 상한 15초(uiautomator dump 가 느린 기기가 있다)
const DEFAULT_TIMEOUT_MS = 15_000
// adb 서버를 먼저 띄우는 데 기다리는 상한(PowerShell 시작 + adb start-server)
const START_SERVER_TIMEOUT_MS = 20_000
// stdout 상한 32MB(screencap PNG 여유)
const MAX_BUFFER = 32 * 1024 * 1024

/**
 * adb 서버를 이 앱의 핸들을 물려받지 않게 띄우는 명령(Windows).
 *
 * 이 앱이 `adb devices` 같은 명령을 그냥 실행하면, 서버가 없을 때 adb 가 스스로 서버(fork-server)를 띄우고
 * 그 서버는 이 앱의 상속 가능한 핸들까지 물려받는다(Windows 의 자식 프로세스는 핸들을 상속한다).
 * 실기 2026-10-24: 앱을 끈 뒤에도 adb 서버가 앱의 디버그 포트(9333) 소켓을 쥐고 있어, 다시 켠 앱이
 * "Cannot start http server for devtools" 로 그 포트를 못 열었다.
 * PowerShell 의 Start-Process(ShellExecute)로 띄운 프로세스는 핸들을 물려받지 않으므로, 그렇게 띄운
 * `adb start-server` 가 만든 서버도 깨끗하다. 이미 떠 있으면 start-server 는 아무 일도 하지 않는다
 */
export function cleanStartServerCommand(adb: string): { command: string; args: string[] } {
  const literal = adb.replace(/'/g, "''")
  return {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Start-Process -FilePath '${literal}' -ArgumentList 'start-server' -WindowStyle Hidden -Wait`
    ]
  }
}

/** 실제 PowerShell 로 adb 서버를 깨끗하게 띄운다. 실패해도 조용히 끝난다(그때는 adb 가 스스로 띄운다) */
function startServerClean(adb: string): Promise<void> {
  return new Promise((resolve) => {
    const c = cleanStartServerCommand(adb)
    execFile(c.command, c.args, { timeout: START_SERVER_TIMEOUT_MS, windowsHide: true }, () =>
      resolve()
    )
  })
}

export function createAdbRunner(
  adbPath: () => string,
  // adb 서버를 먼저 띄우는 방법. 기본은 Windows 에서만 깨끗하게 띄운다(다른 OS 는 핸들 상속 문제가 없다)
  startServer: (adb: string) => Promise<void> = process.platform === 'win32'
    ? startServerClean
    : () => Promise.resolve()
): AdbRunner {
  const bin = (): string => {
    const p = adbPath()
    if (!p) throw new Error('adb path is not set')
    return p
  }
  // adb 경로마다 한 번만 먼저 띄운다. 서버가 나중에 죽어 adb 가 스스로 다시 띄우는 경우까지는 막지 못한다
  let serverFor = ''
  let serverReady: Promise<void> = Promise.resolve()
  const ensureServer = (): Promise<void> => {
    let p = ''
    try {
      p = bin()
    } catch {
      return Promise.resolve()
    }
    if (p !== serverFor) {
      serverFor = p
      serverReady = startServer(p).catch(() => undefined)
    }
    return serverReady
  }

  return {
    run: async (args, timeoutMs = DEFAULT_TIMEOUT_MS) => {
      await ensureServer()
      return new Promise((resolve) => {
        execFile(
          bin(),
          args,
          { timeout: timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true },
          (err, stdout, stderr) => {
            const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0
            resolve({ code, stdout: String(stdout), stderr: String(stderr) })
          }
        )
      })
    },

    runBinary: async (args, timeoutMs = DEFAULT_TIMEOUT_MS) => {
      await ensureServer()
      return new Promise((resolve, reject) => {
        execFile(
          bin(),
          args,
          { timeout: timeoutMs, maxBuffer: MAX_BUFFER, encoding: 'buffer', windowsHide: true },
          (err, stdout) => {
            if (err && (!stdout || stdout.length === 0)) reject(err)
            else resolve(Buffer.from(stdout))
          }
        )
      })
    },

    stream: createSpawner(bin)
  }
}

/**
 * 오래 도는 외부 프로세스 실행기를 만든다(screenrecord·scrcpy 공용).
 * `bin()` 은 경로가 비었으면 던져야 한다 — 그 예외도 종료로 취급해 onEnd 로 알린다.
 * spawn 은 실행 파일이 없으면 'close' 없이 'error' 만 내므로 둘 다 받아야
 * 위 계층(ScreenStream)이 영원히 기다리지 않는다
 */
export function createSpawner(bin: () => string): ProcessSpawner {
  return (args, onData, onEnd) => {
    let child: ChildProcessWithoutNullStreams | null = null
    // close 와 error 가 함께 올 수 있다. 종료 통지는 한 번만 한다
    let ended = false
    const end = (code: number | null): void => {
      if (ended) return
      ended = true
      child = null
      onEnd(code)
    }

    try {
      child = spawn(bin(), args, { windowsHide: true })
    } catch {
      // 경로가 비었거나 spawn 자체가 실패한 경우
      end(null)
      return () => {}
    }

    child.on('error', () => end(null))
    child.stdout.on('data', (c: Buffer) => onData(c))
    child.stdout.on('error', () => end(null))
    // stderr 는 화면 크기 안내 등 잡음이라 버린다(비밀값이 들어올 경로가 아니다)
    child.stderr.resume()
    child.stderr.on('error', () => {})
    child.on('close', (code) => end(code))

    return () => {
      const c = child
      child = null
      ended = true
      // 이미 죽었거나 아예 못 뜬 프로세스에 kill 하면 EINVAL 이 난다 — 무시한다
      try {
        c?.kill()
      } catch {
        /* 이미 끝난 프로세스 */
      }
    }
  }
}
