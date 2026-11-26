import os from 'node:os'
import path from 'node:path'

import helper, { fs } from '@tarojs/helper'
import * as runnerUtils from '@tarojs/runner-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import ReactLikePlugin from '../../taro-framework-react/dist/index.js'
import { Weapp } from '../../taro-platform-weapp/dist/index.js'
import buildMini from '../dist/index.mini'

// Use CJS require so Vitest shares the exact same module singleton as dist/plugins/* and loaders/*
const { componentConfig, componentNameSet, elementNameSet } = require('../dist/utils/context')

const REPO_ROOT = path.resolve(__dirname, '../../..')
const MOCKS_DIR = path.resolve(REPO_ROOT, 'tests/__tests__/mocks')
const BABEL_PRESET_TARO = require.resolve('babel-preset-taro')

const tempDirs: string[] = []
const savedEnv = {
  NODE_ENV: process.env.NODE_ENV,
  TARO_ENV: process.env.TARO_ENV,
  TARO_PLATFORM: process.env.TARO_PLATFORM
}

function createTempDir (prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `taro-rspack-mini-features-${prefix}-`)))
  tempDirs.push(dir)
  return dir
}

function resetComponentConfig () {
  const fresh = runnerUtils.createComponentConfig()
  componentConfig.includes.clear()
  fresh.includes.forEach((item: string) => componentConfig.includes.add(item))
  componentConfig.exclude.clear()
  componentConfig.thirdPartyComponents.clear()
  componentConfig.includeAll = false
  componentConfig.scopedIncludes.clear()
  elementNameSet.clear()
  componentNameSet.clear()
}

function writeAppScaffold (
  appDir: string,
  files: Record<string, string>,
  babelPresetOpts: Record<string, any> = {}
) {
  const presetOpts = {
    framework: 'react',
    ts: true,
    ...babelPresetOpts
  }
  fs.writeFileSync(
    path.join(appDir, 'babel.config.js'),
    `module.exports = { presets: [[${JSON.stringify(BABEL_PRESET_TARO)}, ${JSON.stringify(presetOpts)}]] }\n`
  )
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(appDir, relPath)
    fs.ensureDirSync(path.dirname(fullPath))
    fs.writeFileSync(fullPath, content)
  }
}

async function compileMiniApp (
  appDir: string,
  options: Record<string, any> = {}
) {
  const buildAdapter = options.buildAdapter || 'weapp'
  process.env.TARO_PLATFORM = 'mini'
  process.env.TARO_ENV = buildAdapter
  process.env.NODE_ENV = options.nodeEnv || 'test'

  const outputRoot = createTempDir('out')
  const sourceRoot = options.sourceRoot || 'src'
  const entryFilePath = helper.resolveMainFilePath(path.join(appDir, sourceRoot, 'app'))

  const mockDir = createTempDir('mocks')
  const mockRuntimePath = path.join(mockDir, 'taro-runtime.js')
  fs.writeFileSync(
    mockRuntimePath,
    [
      "export default 'taro-runtime-mock'",
      'export const window = {}',
      'export const Current = {}',
      'export function createReactApp () {}',
      'export function createRecursiveComponentConfig (a, b) { return [a, b] }',
      'export function createPageConfig () {}',
      'export function createComponentConfig () {}'
    ].join('\n')
  )

  const mockComponentsPath = path.join(mockDir, 'taro-components.js')
  fs.writeFileSync(
    mockComponentsPath,
    [
      "export const View = 'view'",
      "export const Text = 'text'",
      "export const Button = 'button'",
      "export const Image = 'image'",
      "export const Video = 'video'",
      "export const Camera = 'camera'",
      "export const Map = 'map'",
      "export const CustomWrapper = 'custom-wrapper'"
    ].join('\n')
  )

  const mockJsxRuntimePath = path.join(mockDir, 'jsx-runtime.js')
  fs.writeFileSync(
    mockJsxRuntimePath,
    [
      'export function jsx (type, props) { return { type, props } }',
      'export function jsxs (type, props) { return { type, props } }',
      'export function jsxDEV (type, props) { return { type, props } }',
      "export const Fragment = 'Fragment'"
    ].join('\n')
  )

  const prevCwd = process.cwd()
  process.chdir(appDir)

  try {
    const program: any = new Weapp({ helper } as any, {})
    program.modifyTemplate?.({})
    const userWebpackChain = options.webpackChain

    const config: any = {
      sourceRoot,
      outputRoot,
      designWidth: 750,
      deviceRatio: { 640: 1.17, 750: 1, 828: 0.905 },
      defineConstants: {},
      env: {
        FRAMEWORK: JSON.stringify('react'),
        TARO_ENV: JSON.stringify(buildAdapter),
        TARO_PLATFORM: JSON.stringify('mini')
      },
      compiler: {
        type: 'rspack'
      },
      buildAdapter,
      platformType: 'mini',
      enableSourceMap: false,
      entry: {
        app: [entryFilePath]
      },
      framework: 'react',
      isWatch: false,
      mode: options.mode || 'production',
      logger: { quiet: true },
      globalObject: program.globalObject,
      fileType: program.fileType,
      template: program.template,
      runtimePath: program.runtimePath,
      taroComponentsPath: mockComponentsPath,
      ...options
    }

    if (options.env) {
      config.env = {
        FRAMEWORK: JSON.stringify('react'),
        TARO_ENV: JSON.stringify(buildAdapter),
        TARO_PLATFORM: JSON.stringify('mini'),
        ...options.env
      }
    }

    config.webpackChain = (chain: any, rspackInstance: any, metaType: any) => {
      const mockCtx: any = {
        initialConfig: {
          framework: 'react',
          mini: { debugReact: true }
        },
        runOpts: { options: {} },
        modifyWebpackChain: (cb: any) => cb({ chain, webpack: rspackInstance, data: { componentConfig } }),
        modifyViteConfig: () => {},
        modifyRunnerOpts: (cb: any) => cb({ opts: config }),
        onParseCreateElement: (cb: any) => {
          const prev = config.onParseCreateElement
          config.onParseCreateElement = (nodeName: string, compCfg: any) => {
            prev?.(nodeName, compCfg)
            cb({ nodeName, componentConfig: compCfg })
          }
        },
        applyPlugins: () => null,
        runnerUtils
      }

      ReactLikePlugin(mockCtx)

      const alias = chain.resolve.alias
      alias.set('@babel/runtime', path.dirname(require.resolve('@babel/runtime/package.json')))
      alias.set('@tarojs/components$', mockComponentsPath)
      alias.set('@tarojs/plugin-framework-react/dist/runtime', path.resolve(MOCKS_DIR, 'taro'))
      alias.set('@tarojs/plugin-platform-weapp/dist/runtime', path.resolve(MOCKS_DIR, 'taro'))
      alias.set('@tarojs/runtime', mockRuntimePath)
      alias.set('@tarojs/shared', path.resolve(MOCKS_DIR, 'taro-shared'))
      alias.set('@tarojs/taro', path.resolve(MOCKS_DIR, 'taro'))
      alias.set('@tarojs/react', path.resolve(MOCKS_DIR, 'taro-react'))
      alias.set('react$', path.resolve(MOCKS_DIR, 'react'))
      alias.set('react/jsx-runtime', mockJsxRuntimePath)
      alias.set('regenerator-runtime', path.resolve(MOCKS_DIR, 'deps'))

      if (typeof userWebpackChain === 'function') {
        userWebpackChain(chain, rspackInstance, metaType)
      }
    }

    const stats = await buildMini(appDir, config)
    return { stats, outputRoot, config }
  } finally {
    process.chdir(prevCwd)
  }
}

beforeEach(() => {
  resetComponentConfig()
})

afterEach(() => {
  resetComponentConfig()
  process.env.NODE_ENV = savedEnv.NODE_ENV
  process.env.TARO_ENV = savedEnv.TARO_ENV
  process.env.TARO_PLATFORM = savedEnv.TARO_PLATFORM
  while (tempDirs.length) {
    const dir = tempDirs.pop()!
    fs.removeSync(dir)
  }
})

describe('@tarojs/rspack-runner MiniProgram features & configs', () => {
  it('supports defineAppConfig and definePageConfig compiler macros', async () => {
    const appDir = createTempDir('macros')
    writeAppScaffold(appDir, {
      'src/app.config.ts': `export default defineAppConfig({
        pages: ['pages/index/index'],
        window: {
          navigationBarTitleText: 'MacroApp',
          navigationBarBackgroundColor: '#123456'
        }
      })`,
      'src/app.tsx': `import React from 'react'
      export default function App (props: any) { return props.children }`,
      'src/pages/index/index.tsx': `import React from 'react'
      import { View, Text } from '@tarojs/components'
      definePageConfig({
        navigationBarTitleText: 'MacroHome',
        enablePullDownRefresh: true
      })
      export default function Index () {
        return <View><Text>MacroPage</Text></View>
      }`
    })

    const { stats, outputRoot } = await compileMiniApp(appDir, {
      terser: { enable: false }
    })

    expect(stats?.hasErrors()).toBe(false)

    const appJson = fs.readJsonSync(path.join(outputRoot, 'app.json'))
    expect(appJson.pages).toEqual(['pages/index/index'])
    expect(appJson.window).toMatchObject({
      navigationBarTitleText: 'MacroApp',
      navigationBarBackgroundColor: '#123456'
    })

    const pageJson = fs.readJsonSync(path.join(outputRoot, 'pages/index/index.json'))
    expect(pageJson.navigationBarTitleText).toBe('MacroHome')
    expect(pageJson.enablePullDownRefresh).toBe(true)

    const pageJs = fs.readFileSync(path.join(outputRoot, 'pages/index/index.js'), 'utf-8')
    expect(pageJs).not.toContain('definePageConfig')
  })

  it('registers CustomWrapper via direct identifier and emits custom-wrapper assets + usingComponents', async () => {
    const appDir = createTempDir('custom-wrapper-id')
    writeAppScaffold(appDir, {
      'src/app.config.ts': `export default { pages: ['pages/index/index'] }`,
      'src/app.tsx': `import React from 'react'
      export default function App (props: any) { return props.children }`,
      'src/pages/index/index.config.ts': `export default { navigationBarTitleText: 'CWId' }`,
      'src/pages/index/index.tsx': `import React from 'react'
      import { View, CustomWrapper, Text } from '@tarojs/components'
      export default function Index () {
        return <View><CustomWrapper><Text>DirectCW</Text></CustomWrapper></View>
      }`
    })

    const { stats, outputRoot } = await compileMiniApp(appDir, {
      nodeEnv: 'production',
      terser: { enable: false }
    })

    expect(stats?.hasErrors()).toBe(false)
    expect(componentConfig.thirdPartyComponents.has('custom-wrapper')).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'custom-wrapper.wxml'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'custom-wrapper.json'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'custom-wrapper.js'))).toBe(true)

    const pageJson = fs.readJsonSync(path.join(outputRoot, 'pages/index/index.json'))
    expect(pageJson.usingComponents['custom-wrapper']).toBeTruthy()
  })

  it('registers CustomWrapper via member expression (Components.CustomWrapper) and emits custom-wrapper assets', async () => {
    const appDir = createTempDir('custom-wrapper-member')
    writeAppScaffold(appDir, {
      'src/app.config.ts': `export default { pages: ['pages/index/index'] }`,
      'src/app.tsx': `import React from 'react'
      export default function App (props: any) { return props.children }`,
      'src/pages/index/index.config.ts': `export default { navigationBarTitleText: 'CWMember' }`,
      'src/pages/index/index.tsx': `import React from 'react'
      import * as Components from '@tarojs/components'
      export default function Index () {
        return <Components.View><Components.CustomWrapper><Components.Text>MemberCW</Components.Text></Components.CustomWrapper></Components.View>
      }`
    })

    const { stats, outputRoot } = await compileMiniApp(appDir, {
      nodeEnv: 'production',
      terser: { enable: false }
    })

    expect(stats?.hasErrors()).toBe(false)
    expect(componentConfig.thirdPartyComponents.has('custom-wrapper')).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'custom-wrapper.wxml'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'custom-wrapper.json'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'custom-wrapper.js'))).toBe(true)

    const pageJson = fs.readJsonSync(path.join(outputRoot, 'pages/index/index.json'))
    expect(pageJson.usingComponents['custom-wrapper']).toBeTruthy()
  })

  it('propagates third-party native component props into base.wxml', async () => {
    const appDir = createTempDir('third-party-props')
    writeAppScaffold(appDir, {
      'src/app.config.ts': `export default { pages: ['pages/index/index'] }`,
      'src/app.tsx': `import React from 'react'
      export default function App (props: any) { return props.children }`,
      'src/components/native-card/index.js': `Component({ properties: { title: String } })`,
      'src/components/native-card/index.json': `{ "component": true }`,
      'src/components/native-card/index.wxml': `<view>{{title}}</view>`,
      'src/components/native-card/index.wxss': `.card { color: red; }`,
      'src/pages/index/index.config.ts': `export default {
        navigationBarTitleText: 'ThirdParty',
        usingComponents: {
          'native-card': '../../components/native-card/index'
        }
      }`,
      'src/pages/index/index.tsx': `import React from 'react'
      import { View } from '@tarojs/components'
      export default function Index () {
        const val = 'hello-prop'
        return <View><native-card title="hi" custom-prop={val} extraFlag={true} /></View>
      }`
    })

    const { stats, outputRoot } = await compileMiniApp(appDir, {
      nodeEnv: 'production',
      terser: { enable: false }
    })

    expect(stats?.hasErrors()).toBe(false)

    const nativeAttrs = componentConfig.thirdPartyComponents.get('native-card')
    expect(nativeAttrs).toBeDefined()
    expect(nativeAttrs?.has('title')).toBe(true)
    expect(nativeAttrs?.has('custom-prop')).toBe(true)
    expect(nativeAttrs?.has('extraFlag')).toBe(true)

    const baseWxml = fs.readFileSync(path.join(outputRoot, 'base.wxml'), 'utf-8')
    expect(baseWxml).toContain('<native-card')
    expect(baseWxml).toContain('title=')
    expect(baseWxml).toContain('custom-prop=')
    expect(baseWxml).toContain('extraFlag=')
  })

  it('collects only used @tarojs/components exports on demand via moduleGraph.getUsedExports', async () => {
    const appDir = createTempDir('used-exports')
    writeAppScaffold(appDir, {
      'src/app.config.ts': `export default { pages: ['pages/index/index'] }`,
      'src/app.tsx': `import React from 'react'
      export default function App (props: any) { return props.children }`,
      'src/pages/index/index.config.ts': `export default { navigationBarTitleText: 'OnDemand' }`,
      'src/pages/index/index.tsx': `import React from 'react'
      import { View, Button } from '@tarojs/components'
      export default function Index () {
        return <View><Button>Tap</Button></View>
      }`
    })

    const { stats, outputRoot } = await compileMiniApp(appDir, {
      nodeEnv: 'production',
      mode: 'production',
      terser: { enable: false }
    })

    expect(stats?.hasErrors()).toBe(false)
    expect(componentConfig.includeAll).toBe(false)
    expect(componentConfig.includes.has('button')).toBe(true)
    expect(componentConfig.includes.has('video')).toBe(false)
    expect(componentConfig.includes.has('camera')).toBe(false)
    expect(componentConfig.includes.has('map')).toBe(false)

    const baseWxml = fs.readFileSync(path.join(outputRoot, 'base.wxml'), 'utf-8')
    expect(baseWxml).toContain('<button ')
    expect(baseWxml).not.toContain('<video ')
    expect(baseWxml).not.toContain('<camera ')
    expect(baseWxml).not.toContain('<map ')
  })

  it('compiles TS type-only re-exports with 0 errors under reexportExportsPresence: false', async () => {
    const appDir = createTempDir('ts-reexports')
    writeAppScaffold(appDir, {
      'src/app.config.ts': `export default { pages: ['pages/index/index'] }`,
      'src/app.tsx': `import React from 'react'
      export default function App (props: any) { return props.children }`,
      'src/types.ts': `export interface SomeInterface { id: string; count: number }
      export type StatusKind = 'ready' | 'done'
      export const RUNTIME_MARKER = 'REEXPORT_RUNTIME_OK'`,
      'src/reexport.ts': `export { SomeInterface, StatusKind, RUNTIME_MARKER } from './types'`,
      'src/pages/index/index.config.ts': `export default { navigationBarTitleText: 'Reexport' }`,
      'src/pages/index/index.tsx': `import React from 'react'
      import { View, Text } from '@tarojs/components'
      import { SomeInterface, RUNTIME_MARKER } from '../../reexport'
      const sample: SomeInterface = { id: '1', count: 2 }
      export default function Index () {
        return <View><Text>{RUNTIME_MARKER}-{sample.id}</Text></View>
      }`
    })

    const { stats, outputRoot } = await compileMiniApp(appDir, {
      nodeEnv: 'production',
      terser: { enable: false }
    })

    expect(stats?.hasErrors()).toBe(false)
    expect(stats?.hasWarnings()).toBe(false)

    const pageJs = fs.readFileSync(path.join(outputRoot, 'pages/index/index.js'), 'utf-8')
    expect(pageJs).toContain('REEXPORT_RUNTIME_OK')
  })

  it('supports copy, string & RegExp alias, defineConstants, and env replacements', async () => {
    const appDir = createTempDir('config-copy-alias-define')
    writeAppScaffold(appDir, {
      'src/static/hello.txt': 'COPIED_STATIC_ASSET_OK',
      'src/utils/greet.ts': `export const GREETING = 'STRING_ALIAS_OK'`,
      'src/utils/secret.ts': `export const SECRET_TOKEN = 'REGEX_ALIAS_OK'`,
      'src/app.config.ts': `export default { pages: ['pages/index/index'] }`,
      'src/app.tsx': `import React from 'react'
      export default function App (props: any) { return props.children }`,
      'src/pages/index/index.config.ts': `export default { navigationBarTitleText: 'ConfigTest' }`,
      'src/pages/index/index.tsx': `import React from 'react'
      import { View, Text } from '@tarojs/components'
      import { GREETING } from '@/utils/greet'
      import { SECRET_TOKEN } from '@regex-alias/secret'
      declare const __APP_FLAG__: string
      export default function Index () {
        return <View><Text>{GREETING}|{SECRET_TOKEN}|{__APP_FLAG__}|{process.env.CUSTOM_ENV_TOKEN}</Text></View>
      }`
    })

    const copiedTarget = path.join(appDir, 'dist/static/hello.txt')
    const { stats, outputRoot } = await compileMiniApp(appDir, {
      terser: { enable: false },
      copy: {
        patterns: [
          { from: 'src/static/hello.txt', to: 'dist/static/hello.txt' }
        ],
        options: {}
      },
      alias: {
        '@/utils': path.join(appDir, 'src/utils')
      },
      defineConstants: {
        __APP_FLAG__: JSON.stringify('DEFINED_CONST_OK')
      },
      env: {
        CUSTOM_ENV_TOKEN: JSON.stringify('ENV_TOKEN_OK')
      },
      webpackChain (chain: any) {
        chain.resolve.alias.set(/^@regex-alias\/secret$/, path.join(appDir, 'src/utils/secret.ts'))
      }
    })

    expect(stats?.hasErrors()).toBe(false)

    expect(fs.existsSync(copiedTarget)).toBe(true)
    expect(fs.readFileSync(copiedTarget, 'utf-8')).toBe('COPIED_STATIC_ASSET_OK')

    const pageJs = fs.readFileSync(path.join(outputRoot, 'pages/index/index.js'), 'utf-8')
    expect(pageJs).toContain('STRING_ALIAS_OK')
    expect(pageJs).toContain('REGEX_ALIAS_OK')
    expect(pageJs).toContain('DEFINED_CONST_OK')
    expect(pageJs).toContain('ENV_TOKEN_OK')
    expect(pageJs).not.toContain('__APP_FLAG__')
    expect(pageJs).not.toContain('process.env.CUSTOM_ENV_TOKEN')
  })

  it('compiles Less, Stylus, and CSS Modules global mode (:local) in MiniProgram', async () => {
    const appDir = createTempDir('preprocessors-css-modules')
    writeAppScaffold(appDir, {
      'src/app.config.ts': `export default { pages: ['pages/index/index'] }`,
      'src/app.tsx': `import React from 'react'
      export default function App (props: any) { return props.children }`,
      'src/pages/index/index.config.ts': `export default { navigationBarTitleText: 'Styles' }`,
      'src/pages/index/index.less': `@brand: #ff5500;
      .less-box {
        color: @brand;
        .less-inner {
          font-size: 28px;
        }
      }`,
      'src/pages/index/index.styl': `accent = #00aa88
      .styl-box
        color accent
        .styl-inner
          font-weight 700`,
      'src/pages/index/styles.css': `:local(.scopedBox) {
        background-color: #112233;
      }`,
      'src/pages/index/reset.global.css': `.plain-global {
        margin: 0;
      }`,
      'src/pages/index/index.tsx': `import React from 'react'
      import { View, Text } from '@tarojs/components'
      import './index.less'
      import './index.styl'
      import styles from './styles.css'
      import './reset.global.css'
      export default function Index () {
        return <View className={styles.scopedBox}><Text className="less-box styl-box plain-global">Styled</Text></View>
      }`
    })

    const { stats, outputRoot } = await compileMiniApp(appDir, {
      terser: { enable: false },
      csso: { enable: false },
      postcss: {
        cssModules: {
          enable: true,
          config: {
            namingPattern: 'global',
            generateScopedName: '[name]__[local]___[hash:base64:5]'
          }
        }
      }
    })

    expect(stats?.hasErrors()).toBe(false)

    const wxssPath = path.join(outputRoot, 'pages/index/index.wxss')
    expect(fs.existsSync(wxssPath)).toBe(true)
    const wxss = fs.readFileSync(wxssPath, 'utf-8')

    // Less compiled (hashed under CSS Modules global mode, px -> rpx transformed)
    expect(wxss).toMatch(/\.index__less-box___[A-Za-z0-9_-]+\s+\.index__less-inner___[A-Za-z0-9_-]+/)
    expect(wxss.toLowerCase()).toContain('#ff5500')
    expect(wxss).toContain('28rpx')

    // Stylus compiled (hashed under CSS Modules global mode)
    expect(wxss).toMatch(/\.index__styl-box___[A-Za-z0-9_-]+\s+\.index__styl-inner___[A-Za-z0-9_-]+/)
    expect(wxss.toLowerCase()).toMatch(/#(00aa88|0a8)/)

    // CSS Modules global mode: :local(...) hashed, *.global.css left unhashed
    expect(wxss).toMatch(/\.styles__scopedBox___[A-Za-z0-9_-]+/)
    expect(wxss).toContain('.plain-global')

    const pageJs = fs.readFileSync(path.join(outputRoot, 'pages/index/index.js'), 'utf-8')
    expect(pageJs).toMatch(/styles__scopedBox___[A-Za-z0-9_-]+/)
  })

  it('respects production minimizer options (default swc+css-minimizer, terser.enable=false, csso.enable=false, jsMinimizer=esbuild)', async () => {
    const appDir = createTempDir('minimizers')
    writeAppScaffold(appDir, {
      'src/app.config.ts': `export default { pages: ['pages/index/index'] }`,
      'src/app.tsx': `import React from 'react'
      export default function App (props: any) { return props.children }`,
      'src/pages/index/index.config.ts': `export default { navigationBarTitleText: 'Min' }`,
      'src/pages/index/index.css': `/* CSS_MINIMIZER_BANNER_COMMENT */
      .min-box {
        color: #ff0000;
        background-color: #ffffff;
      }`,
      'src/pages/index/index.tsx': `import React from 'react'
      import { View, Text } from '@tarojs/components'
      import './index.css'
      /* JS_MINIMIZER_BANNER_COMMENT */
      function computeVeryLongDescriptiveFunctionName (firstVeryLongArg: string, secondVeryLongArg: string) {
        return firstVeryLongArg + '-' + secondVeryLongArg
      }
      export default function Index () {
        const computedDisplayLabel = computeVeryLongDescriptiveFunctionName('alpha', 'beta')
        return <View className="min-box"><Text>{computedDisplayLabel}</Text></View>
      }`
    })

    // 1. Default production: SwcJsMinimizerRspackPlugin + LightningCssMinimizerRspackPlugin
    let defaultMinimizerNames: string[] = []
    const defaultRes = await compileMiniApp(appDir, {
      mode: 'production',
      webpackChain (chain: any) {
        defaultMinimizerNames = Object.keys(chain.optimization.minimizers.entries() || {})
      }
    })
    expect(defaultRes.stats?.hasErrors()).toBe(false)
    expect(defaultMinimizerNames).toContain('terserPlugin')
    expect(defaultMinimizerNames).toContain('cssoWebpackPlugin')
    const defaultJs = fs.readFileSync(path.join(defaultRes.outputRoot, 'pages/index/index.js'), 'utf-8')
    const defaultCss = fs.readFileSync(path.join(defaultRes.outputRoot, 'pages/index/index.wxss'), 'utf-8')
    expect(defaultJs).not.toContain('JS_MINIMIZER_BANNER_COMMENT')
    expect(defaultJs).not.toContain('firstVeryLongArg')
    expect(defaultCss).not.toContain('CSS_MINIMIZER_BANNER_COMMENT')

    // 2. terser: { enable: false } -> disables JS minimization
    let noTerserMinimize: boolean | undefined
    const noTerserRes = await compileMiniApp(appDir, {
      mode: 'production',
      terser: { enable: false },
      webpackChain (chain: any) {
        noTerserMinimize = chain.optimization.get('minimize')
      }
    })
    expect(noTerserRes.stats?.hasErrors()).toBe(false)
    expect(noTerserMinimize).toBe(false)
    const noTerserJs = fs.readFileSync(path.join(noTerserRes.outputRoot, 'pages/index/index.js'), 'utf-8')
    expect(noTerserJs).toContain('firstVeryLongArg')
    expect(noTerserJs.length).toBeGreaterThan(defaultJs.length)

    // 3. csso: { enable: false } -> JS minified, CSS minimizer omitted
    let noCssoMinimizerNames: string[] = []
    const noCssoRes = await compileMiniApp(appDir, {
      mode: 'production',
      csso: { enable: false },
      webpackChain (chain: any) {
        noCssoMinimizerNames = Object.keys(chain.optimization.minimizers.entries() || {})
      }
    })
    expect(noCssoRes.stats?.hasErrors()).toBe(false)
    expect(noCssoMinimizerNames).toContain('terserPlugin')
    expect(noCssoMinimizerNames).not.toContain('cssoWebpackPlugin')
    const noCssoJs = fs.readFileSync(path.join(noCssoRes.outputRoot, 'pages/index/index.js'), 'utf-8')
    const noCssoCss = fs.readFileSync(path.join(noCssoRes.outputRoot, 'pages/index/index.wxss'), 'utf-8')
    expect(noCssoJs).not.toContain('firstVeryLongArg')
    expect(noCssoCss).toContain('CSS_MINIMIZER_BANNER_COMMENT')

    // 4. jsMinimizer: 'esbuild' -> uses esBuildMinifyPlugin (mapped to SwcJsMinimizerRspackPlugin)
    let esbuildMinimizerNames: string[] = []
    const esbuildRes = await compileMiniApp(appDir, {
      mode: 'production',
      jsMinimizer: 'esbuild',
      webpackChain (chain: any) {
        esbuildMinimizerNames = Object.keys(chain.optimization.minimizers.entries() || {})
      }
    })
    expect(esbuildRes.stats?.hasErrors()).toBe(false)
    expect(esbuildMinimizerNames).toContain('esBuildMinifyPlugin')
    expect(esbuildMinimizerNames).toContain('cssoWebpackPlugin')
    const esbuildJs = fs.readFileSync(path.join(esbuildRes.outputRoot, 'pages/index/index.js'), 'utf-8')
    expect(esbuildJs).not.toContain('JS_MINIMIZER_BANNER_COMMENT')
    expect(esbuildJs).not.toContain('firstVeryLongArg')
  })
})
