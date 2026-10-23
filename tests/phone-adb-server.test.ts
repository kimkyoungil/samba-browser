// adb 서버를 앱 핸들을 물려받지 않게 먼저 띄운다 — 꺼진 앱의 포트를 adb 서버가 쥐고 있던 문제
import { describe, it, expect } from 'vitest'
import { cleanStartServerCommand, createAdbRunner } from '../src/main/phone/process'

describe('cleanStartServerCommand', () => {
  it('PowerShell Start-Process 로 start-server 를 띄우고, 공백·작은따옴표가 든 경로도 깨지지 않는다', () => {
    const c = cleanStartServerCommand("C:\\Users\\K'I\\AppData\\Roaming\\SAMBA Browser\\adb.exe")
    expect(c.command).toBe('powershell.exe')
    expect(c.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    expect(c.args[3]).toBe(
      "Start-Process -FilePath 'C:\\Users\\K''I\\AppData\\Roaming\\SAMBA Browser\\adb.exe' -ArgumentList 'start-server' -WindowStyle Hidden -Wait"
    )
  })
})

describe('createAdbRunner — 서버를 먼저 띄운다', () => {
  it('adb 경로마다 한 번만, 명령보다 먼저 띄운다', async () => {
    let path = 'C:\\nowhere\\adb-a.exe'
    const started: string[] = []
    const runner = createAdbRunner(
      () => path,
      async (adb) => {
        started.push(adb)
      }
    )
    // 없는 실행 파일이라 명령은 실패로 끝나지만, 서버 띄우기는 그 전에 한 번 불린다
    const r1 = await runner.run(['devices'], 2000)
    await runner.run(['devices'], 2000)
    expect(r1.code).not.toBe(0)
    expect(started).toEqual(['C:\\nowhere\\adb-a.exe'])
    path = 'C:\\nowhere\\adb-b.exe'
    await runner.run(['devices'], 2000)
    expect(started).toEqual(['C:\\nowhere\\adb-a.exe', 'C:\\nowhere\\adb-b.exe'])
  })

  it('경로가 비었으면 서버를 띄우지 않고, 띄우기가 실패해도 명령은 돈다', async () => {
    const started: string[] = []
    const empty = createAdbRunner(
      () => '',
      async (adb) => {
        started.push(adb)
      }
    )
    await expect(empty.run(['devices'])).rejects.toThrow('adb path is not set')
    expect(started).toEqual([])
    const failing = createAdbRunner(
      () => 'C:\\nowhere\\adb.exe',
      async () => {
        throw new Error('powershell missing')
      }
    )
    const r = await failing.run(['devices'], 2000)
    expect(typeof r.code).toBe('number')
  })
})
