#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const mobileDir = path.resolve(import.meta.dirname, '..')
const isWindows = process.platform === 'win32'

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate))
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? mobileDir,
    env: options.env ?? process.env,
    stdio: 'inherit',
    shell: isWindows
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const androidHome = firstExisting([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
  path.join(os.homedir(), 'Library', 'Android', 'sdk'),
  path.join(os.homedir(), 'Android', 'Sdk'),
  '/opt/homebrew/share/android-commandlinetools'
])
const javaHome = firstExisting([
  process.env.JAVA_HOME,
  '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
  '/usr/lib/jvm/java-17-openjdk-amd64',
  '/usr/lib/jvm/java-17-openjdk-arm64'
])

if (!androidHome) {
  throw new Error('Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT.')
}
if (!javaHome) {
  throw new Error('JDK 17 not found. Set JAVA_HOME to a JDK 17 installation.')
}

run(isWindows ? 'pnpm.cmd' : 'pnpm', [
  'exec',
  'expo',
  'prebuild',
  '--platform',
  'android',
  '--clean',
  '--no-install'
])

const buildEnvironment = {
  ...process.env,
  ANDROID_HOME: androidHome,
  JAVA_HOME: javaHome,
  NODE_ENV: 'production'
}
run(
  path.join(mobileDir, 'android', isWindows ? 'gradlew.bat' : 'gradlew'),
  [':app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a'],
  { cwd: path.join(mobileDir, 'android'), env: buildEnvironment }
)

const sourceApk = path.join(
  mobileDir,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk'
)
const destinationDir = path.join(mobileDir, 'dist')
const destinationApk = path.join(destinationDir, 'orca-thor-android-arm64.apk')
mkdirSync(destinationDir, { recursive: true })
copyFileSync(sourceApk, destinationApk)
console.log(`\nBuilt ${destinationApk}`)
