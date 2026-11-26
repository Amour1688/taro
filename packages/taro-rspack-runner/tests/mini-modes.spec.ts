import os from 'node:os'
import path from 'node:path'

import { rspack } from '@rspack/core'
import helper, { fs } from '@tarojs/helper'
import * as runnerUtils from '@tarojs/runner-utils'
import { StaticMiniSplitChunksPlugin } from '@tarojs/runner-utils/bundler/splitChunks'
import { afterEach, describe, expect, it } from 'vitest'

import ReactLikePlugin from '../../taro-framework-react/dist/index.js'
import { Weapp } from '../../taro-platform-weapp/dist/index.js'
import buildMini from '../dist/index.mini'
import { componentConfig } from '../dist/utils/context'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const MOCKS_DIR = path.resolve(REPO_ROOT, 'tests/__tests__/mocks')
const BABEL_PRESET_TARO_PATH = require.resolve('babel-preset-taro')

const tempDirs: string[] = []

function createTmpDir (prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `taro-rspack-modes-${prefix}-`)))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!
    fs.removeSync(dir)
  }
})

function writeBabelConfig (appDir: string) {
  fs.writeFileSync(
    path.join(appDir, 'babel.config.js'),
    `module.exports = { presets: [[${JSON.stringify(BABEL_PRESET_TARO_PATH)}, { framework: 'react', ts: true }]] }`
  )
}

interface CompileModeOptions extends Record<string, any> {
  mockRuntimeContent?: string
  runtimeAliasPath?: string
  runtimePlatformPath?: string
}

async function compileMiniProject (
  appDir: string,
  options: CompileModeOptions = {}
) {
  const buildAdapter = options.buildAdapter || 'weapp'
  process.env.TARO_PLATFORM = 'mini'
  process.env.TARO_ENV = buildAdapter
  process.env.NODE_ENV = options.nodeEnv || 'test'

  const outputRoot = createTmpDir(`dist-${path.basename(appDir)}`)
  const sourceRoot = options.sourceRoot || 'src'
  const entryFilePath = options.isBuildPlugin
    ? undefined
    : helper.resolveMainFilePath(path.join(appDir, sourceRoot, 'app'))

  const prevCwd = process.cwd()
  process.chdir(appDir)

  try {
    const program: any = new Weapp({ helper } as any, {})
    program.modifyTemplate?.({})

    const {
      mockRuntimeContent,
      runtimeAliasPath,
      runtimePlatformPath,
      webpackChain: userWebpackChain,
      ...restOptions
    } = options

    const config: any = {
      sourceRoot,
      outputRoot,
      designWidth: 750,
      deviceRatio: { 640: 1.17, 750: 1, 828: 0.905 },
      defineConstants: {},
      env: {
        FRAMEWORK: JSON.stringify('react'),
        TARO_ENV: JSON.stringify(buildAdapter),
        TARO_PLATFORM: JSON.stringify('mini'),
      },
      compiler: {
        type: 'rspack',
      },
      buildAdapter,
      platformType: 'mini',
      enableSourceMap: false,
      ...(entryFilePath ? { entry: { app: [entryFilePath] } } : {}),
      framework: 'react',
      isWatch: false,
      mode: options.mode || 'production',
      terser: { enable: false },
      logger: { quiet: true },
      globalObject: program.globalObject,
      fileType: program.fileType,
      template: program.template,
      runtimePath: runtimePlatformPath ?? program.runtimePath,
      taroComponentsPath: `@tarojs/plugin-platform-${buildAdapter}/dist/components-react`,
      ...restOptions,
    }

    config.webpackChain = (chain: any, rspackInstance: any, metaType: any) => {
      const mockCtx: any = {
        initialConfig: {
          framework: 'react',
          mini: { debugReact: true },
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
        runnerUtils,
      }
      ReactLikePlugin(mockCtx)

      let resolvedMockRuntime = runtimeAliasPath
      if (!resolvedMockRuntime) {
        const mockRuntimeDir = createTmpDir('mock-runtime')
        resolvedMockRuntime = path.join(mockRuntimeDir, 'taro-runtime.js')
        fs.writeFileSync(
          resolvedMockRuntime,
          mockRuntimeContent || [
            "export default 'taro-runtime-mock'",
            'export const window = {}',
            'export const Current = {}',
            'export function createReactApp () { return { onLaunch () {} } }',
            'export function createRecursiveComponentConfig () { return {} }',
            'export function createPageConfig () { return { onLoad () {} } }',
            'export function createComponentConfig () { return {} }',
            'export function createNativeComponentConfig () { return {} }',
          ].join('\n')
        )
      }

      const alias = chain.resolve.alias
      alias.set('@babel/runtime', path.dirname(require.resolve('@babel/runtime/package.json')))
      alias.set('@tarojs/components$', path.resolve(MOCKS_DIR, 'taro-components'))
      alias.set('@tarojs/plugin-framework-react/dist/runtime', path.resolve(MOCKS_DIR, 'taro'))
      alias.set(`@tarojs/plugin-platform-${buildAdapter}/dist/runtime`, path.resolve(MOCKS_DIR, 'taro'))
      alias.set('@tarojs/runtime', resolvedMockRuntime)
      alias.set('@tarojs/shared', path.resolve(MOCKS_DIR, 'taro-shared'))
      alias.set('@tarojs/taro', path.resolve(MOCKS_DIR, 'taro'))
      alias.set('@tarojs/react', path.resolve(MOCKS_DIR, 'taro-react'))
      alias.set('react$', path.resolve(MOCKS_DIR, 'react'))
      alias.set('react/jsx-runtime', path.resolve(MOCKS_DIR, 'react'))
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

describe('MiniProgram build modes, hooks & splitChunks edge cases under Rspack 2.3.4', () => {
  it('BuildNativePlugin (isBuildNativeComp: true): omits app.json/app.js, injects common styles, applies taroRuntime loader & chunk requires', async () => {
    const appDir = createTmpDir('build-native-comp')
    writeBabelConfig(appDir)

    fs.ensureDirSync(path.join(appDir, 'src/components/card'))
    fs.ensureDirSync(path.join(appDir, 'src/components/badge'))
    fs.ensureDirSync(path.join(appDir, 'src/styles'))
    // Place mock runtime under node_modules/@tarojs/runtime so MiniRspackModule's
    // /@tarojs[\\/]runtime/ taroRuntime rule matches and runs @tarojs/taro-loader/lib/taro-runtime!
    const runtimeDir = path.join(appDir, 'node_modules/@tarojs/runtime')
    const platformRuntimeFile = path.join(appDir, 'src/platform-runtime-marker.js')
    fs.ensureDirSync(runtimeDir)
    fs.writeFileSync(
      platformRuntimeFile,
      'export const PLATFORM_RUNTIME_INJECTED = "TARO_PLATFORM_RUNTIME_INJECTED_OK";\nconsole.log(PLATFORM_RUNTIME_INJECTED);\n'
    )
    const runtimeEntryFile = path.join(runtimeDir, 'index.js')
    fs.writeFileSync(
      runtimeEntryFile,
      [
        "export default 'taro-runtime-native-mock'",
        'export const window = {}',
        'export const Current = {}',
        'export function createReactApp () { return {} }',
        'export function createRecursiveComponentConfig () { return {} }',
        'export function createPageConfig () { return {} }',
        'export function createComponentConfig () { return {} }',
        'export function createNativeComponentConfig () { return {} }',
      ].join('\n')
    )

    fs.writeFileSync(
      path.join(appDir, 'src/app.config.ts'),
      `export default {
        components: ['components/card/index', 'components/badge/index']
      }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/app.tsx'),
      `export default function App (props: any) { return props.children }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/styles/shared.css'),
      `.shared-native-style { color: #ff0000; font-size: 28px; }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/shared-helper.ts'),
      `export const SHARED_NATIVE_HELPER = 'SHARED_NATIVE_HELPER_VALUE'`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/components/card/index.config.ts'),
      `export default { component: true }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/components/card/index.css'),
      `.card-box { padding: 12px; }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/components/card/index.tsx'),
      `import React from 'react'
      import { View, Text } from '@tarojs/components'
      import '../../styles/shared.css'
      import './index.css'
      import { SHARED_NATIVE_HELPER } from '../../shared-helper'
      export default function Card () {
        return <View className="card-box shared-native-style"><Text>{SHARED_NATIVE_HELPER}-Card</Text></View>
      }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/components/badge/index.config.ts'),
      `export default { component: true }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/components/badge/index.css'),
      `.badge-box { margin: 8px; }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/components/badge/index.tsx'),
      `import React from 'react'
      import { View, Text } from '@tarojs/components'
      import '../../styles/shared.css'
      import './index.css'
      import { SHARED_NATIVE_HELPER } from '../../shared-helper'
      export default function Badge () {
        return <View className="badge-box shared-native-style"><Text>{SHARED_NATIVE_HELPER}-Badge</Text></View>
      }`
    )

    const { stats, outputRoot } = await compileMiniProject(appDir, {
      isBuildNativeComp: true,
      compile: {
        exclude: [/node_modules[\\/]@tarojs[\\/]runtime/],
      },
      runtimeAliasPath: runtimeEntryFile,
      runtimePlatformPath: platformRuntimeFile,
    })

    expect(stats?.hasErrors()).toBe(false)

    // BuildNativePlugin omits app.json and app.js
    expect(fs.existsSync(path.join(outputRoot, 'app.json'))).toBe(false)
    expect(fs.existsSync(path.join(outputRoot, 'app.js'))).toBe(false)

    // Component files (.js/.wxml/.wxss/.json) emitted
    for (const comp of ['components/card/index', 'components/badge/index']) {
      expect(fs.existsSync(path.join(outputRoot, `${comp}.js`))).toBe(true)
      expect(fs.existsSync(path.join(outputRoot, `${comp}.wxml`))).toBe(true)
      expect(fs.existsSync(path.join(outputRoot, `${comp}.wxss`))).toBe(true)
      expect(fs.existsSync(path.join(outputRoot, `${comp}.json`))).toBe(true)
    }

    // Shared styles extracted to common.wxss and @import injected into component .wxss via injectCommonStyles
    expect(fs.existsSync(path.join(outputRoot, 'common.wxss'))).toBe(true)
    const cardWxss = fs.readFileSync(path.join(outputRoot, 'components/card/index.wxss'), 'utf-8')
    const badgeWxss = fs.readFileSync(path.join(outputRoot, 'components/badge/index.wxss'), 'utf-8')
    expect(cardWxss).toContain('@import "../../common.wxss";')
    expect(badgeWxss).toContain('@import "../../common.wxss";')

    // BuildNativePlugin.addLoadChunksPlugin injects chunk group requires into component JS
    const cardJs = fs.readFileSync(path.join(outputRoot, 'components/card/index.js'), 'utf-8')
    expect(cardJs).toContain('require("../../runtime")')
    expect(cardJs).toContain('require("../../common")')

    // taroRuntime loader prepended platformRuntimeFile before @tarojs/runtime
    const allBuiltJs = ['runtime.js', 'taro.js', 'vendors.js', 'common.js', 'components/card/index.js']
      .map(f => path.join(outputRoot, f))
      .filter(f => fs.existsSync(f))
      .map(f => fs.readFileSync(f, 'utf-8'))
      .join('\n')
    expect(allBuiltJs).toContain('TARO_PLATFORM_RUNTIME_INJECTED_OK')
  })

  it('Mini native plugin mode (isBuildPlugin: true): parses src/plugin/plugin.json and emits main, publicComponents, pages & plugin.json', async () => {
    const appDir = createTmpDir('build-mini-plugin')
    writeBabelConfig(appDir)

    fs.ensureDirSync(path.join(appDir, 'src/plugin/components/hello'))
    fs.ensureDirSync(path.join(appDir, 'src/plugin/pages/plugin-page'))

    fs.writeJsonSync(path.join(appDir, 'src/plugin/plugin.json'), {
      publicComponents: {
        'hello-comp': 'components/hello/index',
      },
      pages: {
        'plugin-page': 'pages/plugin-page/index',
      },
      main: 'index.ts',
    })
    fs.writeFileSync(
      path.join(appDir, 'src/plugin/index.ts'),
      `export function sayHello (name: string) {
        return 'PLUGIN_MAIN_HELLO:' + name
      }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/plugin/components/hello/index.config.ts'),
      `export default { component: true }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/plugin/components/hello/index.tsx'),
      `import React from 'react'
      import { View, Text } from '@tarojs/components'
      export default function HelloComp () {
        return <View><Text>PluginPublicComponent</Text></View>
      }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/plugin/pages/plugin-page/index.config.ts'),
      `export default { navigationBarTitleText: 'PluginPage' }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/plugin/pages/plugin-page/index.tsx'),
      `import React from 'react'
      import { View, Text } from '@tarojs/components'
      export default function PluginPage () {
        return <View><Text>PluginPageContent</Text></View>
      }`
    )

    const { stats, outputRoot } = await compileMiniProject(appDir, {
      isBuildPlugin: true,
    })

    expect(stats?.hasErrors()).toBe(false)

    // Emitted plugin.json has main normalized to .js and comp registered in publicComponents
    expect(fs.existsSync(path.join(outputRoot, 'plugin.json'))).toBe(true)
    const emittedPluginJson = fs.readJsonSync(path.join(outputRoot, 'plugin.json'))
    expect(emittedPluginJson.main).toBe('index.js')
    expect(emittedPluginJson.publicComponents?.['hello-comp']).toBe('components/hello/index')
    expect(emittedPluginJson.publicComponents?.comp).toBe('comp')
    expect(emittedPluginJson.pages?.['plugin-page']).toBe('pages/plugin-page/index')

    // Plugin main entry, public component, page, and base templates all emitted
    expect(fs.existsSync(path.join(outputRoot, 'index.js'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'base.wxml'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'comp.js'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'components/hello/index.js'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'components/hello/index.wxml'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'components/hello/index.json'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'pages/plugin-page/index.js'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'pages/plugin-page/index.wxml'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'pages/plugin-page/index.json'))).toBe(true)

    const mainJs = fs.readFileSync(path.join(outputRoot, 'index.js'), 'utf-8')
    expect(mainJs).toContain('PLUGIN_MAIN_HELLO:')
    expect(mainJs).toContain('require("./runtime")')
    const compJs = fs.readFileSync(path.join(outputRoot, 'components/hello/index.js'), 'utf-8')
    expect(compJs).toContain('require("../../runtime")')
  })

  it('Prerender: renders static WXML fallback on matched/included pages, skips excluded pages, and applies transformData & transformXML', async () => {
    const appDir = createTmpDir('prerender-mode')
    writeBabelConfig(appDir)

    fs.ensureDirSync(path.join(appDir, 'src/pages/index'))
    fs.ensureDirSync(path.join(appDir, 'src/others/detail'))
    fs.ensureDirSync(path.join(appDir, 'src/others/normal'))

    fs.writeFileSync(
      path.join(appDir, 'src/app.config.ts'),
      `export default {
        pages: ['pages/index/index', 'others/detail/index', 'others/normal/index']
      }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/app.tsx'),
      `export default function App (props: any) { return props.children }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pages/index/index.config.ts'),
      `export default { navigationBarTitleText: 'Home' }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pages/index/index.tsx'),
      `import React from 'react'
      import { View, Text } from '@tarojs/components'
      export default function Index () {
        return <View><Text>PrerenderHome</Text></View>
      }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/others/detail/index.config.ts'),
      `export default { navigationBarTitleText: 'Detail' }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/others/detail/index.tsx'),
      `import React from 'react'
      import { View, Text } from '@tarojs/components'
      export default function Detail () {
        return <View><Text>PrerenderDetail</Text></View>
      }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/others/normal/index.config.ts'),
      `export default { navigationBarTitleText: 'Normal' }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/others/normal/index.tsx'),
      `import React from 'react'
      import { View, Text } from '@tarojs/components'
      export default function Normal () {
        return <View><Text>ExcludedNormal</Text></View>
      }`
    )

    // Mock runtime that returns realistic Taro MiniData trees during real vm2 Prerender execution
    const prerenderMockRuntime = [
      "export default 'taro-prerender-runtime'",
      'export const window = {}',
      'export const Current = {}',
      'export function createReactApp () { return { onLaunch () {} } }',
      'export function createRecursiveComponentConfig () { return {} }',
      'export function createComponentConfig () { return {} }',
      'export function createPageConfig (_comp, pageName) {',
      '  return {',
      '    onLoad (_params, cb) {',
      "      if (typeof cb !== 'function') return",
      "      if (pageName === 'pages/index/index') {",
      '        cb({',
      "          'root.cn.[0]': {",
      "            nn: 'view', uid: '_n_home', cl: 'home-root',",
      "            cn: [{ nn: 'text', uid: '_n_t1', cn: [{ nn: '#text', v: 'Prerendered Home Text' }] }]",
      '          }',
      '        })',
      "      } else if (pageName === 'others/detail/index') {",
      '        cb({',
      "          'root.cn.[0]': {",
      "            nn: 'view', uid: '_n_detail', cl: 'detail-root',",
      "            cn: [{ nn: 'text', uid: '_n_t2', cn: [{ nn: '#text', v: 'Original Detail Text' }] }]",
      '          }',
      '        })',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n')

    const mockReactFrameworkPath = path.join(createTmpDir('prerender-fw-mock'), 'react-runtime.js')
    fs.writeFileSync(
      mockReactFrameworkPath,
      [
        'export function createReactApp () { return { onLaunch () {} } }',
        'export function connectReactPage () {}',
        'export function createNativeComponentConfig () { return {} }',
        'export function setReconciler () {}',
      ].join('\n')
    )

    const seenTransformDataPaths: string[] = []
    const seenTransformXmlPaths: string[] = []

    const { stats, outputRoot } = await compileMiniProject(appDir, {
      mockRuntimeContent: prerenderMockRuntime,
      webpackChain (chain: any) {
        chain.resolve.alias.set('@tarojs/plugin-framework-react/dist/runtime', mockReactFrameworkPath)
      },
      prerender: {
        match: 'others/**',
        include: ['pages/index/index'],
        exclude: ['others/normal/index'],
        transformData (data: any, { path: pagePath }: { path: string }) {
          seenTransformDataPaths.push(pagePath)
          if (pagePath === 'pages/index/index') {
            return { ...data, cl: 'home-root transformed-data' }
          }
          return data
        },
        transformXML (_data: any, { path: pagePath }: { path: string }, xml: string) {
          seenTransformXmlPaths.push(pagePath)
          if (pagePath === 'others/detail/index') {
            return '<view class="custom-xml-override">Transformed Detail XML</view>'
          }
          return xml
        },
      },
    })

    expect(stats?.hasErrors()).toBe(false)
    expect(seenTransformDataPaths.sort()).toEqual(['others/detail/index', 'pages/index/index'])
    expect(seenTransformXmlPaths.sort()).toEqual(['others/detail/index', 'pages/index/index'])

    // Included page gets prerendered WXML block + transformData applied
    const indexWxml = fs.readFileSync(path.join(outputRoot, 'pages/index/index.wxml'), 'utf-8')
    expect(indexWxml).toContain('<block wx:if="{{root.uid}}">')
    expect(indexWxml).toContain('<block wx:else>')
    expect(indexWxml).toContain('class="home-root transformed-data"')
    expect(indexWxml).toContain('Prerendered Home Text')

    // Matched page gets transformXML applied
    const detailWxml = fs.readFileSync(path.join(outputRoot, 'others/detail/index.wxml'), 'utf-8')
    expect(detailWxml).toContain('<block wx:else>')
    expect(detailWxml).toContain('<view class="custom-xml-override">Transformed Detail XML</view>')

    // Excluded page is NOT prerendered
    const normalWxml = fs.readFileSync(path.join(outputRoot, 'others/normal/index.wxml'), 'utf-8')
    expect(normalWxml).not.toContain('<block wx:else>')
  })

  it('Skyline rendering mode: preserves renderer="skyline", componentFramework="glass-easel", rendererOptions & templates', async () => {
    const appDir = createTmpDir('skyline-mode')
    writeBabelConfig(appDir)

    fs.ensureDirSync(path.join(appDir, 'src/pages/index'))

    fs.writeFileSync(
      path.join(appDir, 'src/app.config.ts'),
      `export default {
        pages: ['pages/index/index'],
        lazyCodeLoading: 'requiredComponents',
        rendererOptions: {
          skyline: {
            defaultDisplayBlock: true
          }
        }
      }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/app.tsx'),
      `export default function App (props: any) { return props.children }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pages/index/index.config.ts'),
      `export default {
        navigationBarTitleText: 'SkylineHome',
        renderer: 'skyline',
        componentFramework: 'glass-easel',
        navigationStyle: 'custom',
        disableScroll: true
      }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pages/index/index.tsx'),
      `import React from 'react'
      import { View, Text } from '@tarojs/components'
      export default function SkylinePage () {
        return <View><Text>SkylineReady</Text></View>
      }`
    )

    const { stats, outputRoot } = await compileMiniProject(appDir)

    expect(stats?.hasErrors()).toBe(false)

    const appJson = fs.readJsonSync(path.join(outputRoot, 'app.json'))
    expect(appJson.lazyCodeLoading).toBe('requiredComponents')
    expect(appJson.rendererOptions).toEqual({ skyline: { defaultDisplayBlock: true } })

    const pageJson = fs.readJsonSync(path.join(outputRoot, 'pages/index/index.json'))
    expect(pageJson.renderer).toBe('skyline')
    expect(pageJson.componentFramework).toBe('glass-easel')
    expect(pageJson.navigationStyle).toBe('custom')
    expect(pageJson.disableScroll).toBe(true)
    expect(pageJson.usingComponents?.comp).toBe('../../comp')

    expect(fs.existsSync(path.join(outputRoot, 'base.wxml'))).toBe(true)
    expect(fs.existsSync(path.join(outputRoot, 'pages/index/index.wxml'))).toBe(true)
    const pageWxml = fs.readFileSync(path.join(outputRoot, 'pages/index/index.wxml'), 'utf-8')
    expect(pageWxml).toContain('../../base.wxml')
  })

  it('Hooks (modifyBuildAssets & addChunkPages this.appConfig): wraps assets safely and binds appConfig in addChunkPages', async () => {
    const appDir = createTmpDir('hooks-parity')
    writeBabelConfig(appDir)

    fs.ensureDirSync(path.join(appDir, 'src/pages/index'))
    fs.ensureDirSync(path.join(appDir, 'src/pkgA/detail'))
    fs.ensureDirSync(path.join(appDir, 'src/pkgA/my'))

    fs.writeFileSync(
      path.join(appDir, 'src/app.config.ts'),
      `export default {
        pages: ['pages/index/index'],
        subPackages: [
          {
            root: 'pkgA',
            pages: ['detail/index', 'my/index']
          }
        ]
      }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/app.tsx'),
      `export default function App (props: any) { return props.children }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pages/index/index.config.ts'),
      `export default { navigationBarTitleText: 'Index' }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pages/index/index.tsx'),
      `import React from 'react'
      import { View } from '@tarojs/components'
      export default function Index () { return <View /> }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pkgA/pkg-util.ts'),
      `export const PKG_UTIL_VAL = 'PKG_UTIL_SHARED'`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pkgA/detail/index.config.ts'),
      `export default { navigationBarTitleText: 'Detail' }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pkgA/detail/index.tsx'),
      `import React from 'react'
      import { View, Text } from '@tarojs/components'
      import { PKG_UTIL_VAL } from '../pkg-util'
      export default function Detail () { return <View><Text>{PKG_UTIL_VAL}-detail</Text></View> }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pkgA/my/index.config.ts'),
      `export default { navigationBarTitleText: 'My' }`
    )
    fs.writeFileSync(
      path.join(appDir, 'src/pkgA/my/index.tsx'),
      `import React from 'react'
      import { View, Text } from '@tarojs/components'
      import { PKG_UTIL_VAL } from '../pkg-util'
      export default function My () { return <View><Text>{PKG_UTIL_VAL}-my</Text></View> }`
    )

    let assetsStringified = ''
    let hasAppJsOwnProp = false
    let readAppJsLength = 0
    let seenAppConfig: any

    const { stats, outputRoot } = await compileMiniProject(appDir, {
      webpackChain (chain: any) {
        const sc = chain.optimization.get('splitChunks')
        chain.optimization.splitChunks({
          ...sc,
          cacheGroups: {
            ...sc.cacheGroups,
            subutils: {
              name: 'sub-utils',
              minChunks: 2,
              test: (module: any) => /[\\/]pkgA[\\/]pkg-util/.test(module.resource || ''),
              priority: 20000,
            },
          },
        })
      },
      addChunkPages (this: any, pages: Map<string, string[]>) {
        seenAppConfig = this.appConfig
        const subpkg = this.appConfig?.subPackages?.[0]
        if (subpkg?.root && Array.isArray(subpkg.pages)) {
          for (const page of subpkg.pages) {
            pages.set(`${subpkg.root}/${page}`, ['sub-utils'])
          }
        }
      },
      modifyBuildAssets (assets: Record<string, any>) {
        // Must not throw TypeError on Rspack's compilation.assets Proxy
        assetsStringified = String(assets)
        hasAppJsOwnProp = Object.prototype.hasOwnProperty.call(assets, 'app.js') || assets.hasOwnProperty('app.js')
        readAppJsLength = String(assets['app.js']?.source?.() || '').length

        // Add an asset and modify an existing asset, then delete a temporary asset
        const { RawSource } = rspack.sources
        assets['custom-injected.txt'] = new RawSource('INJECTED_BY_MODIFY_BUILD_ASSETS')
        assets['to-be-deleted.txt'] = new RawSource('TEMP')
        delete assets['to-be-deleted.txt']
      },
    })

    expect(stats?.hasErrors()).toBe(false)

    // modifyBuildAssets assertions
    expect(assetsStringified).toBe('[object CompilationAssets]')
    expect(hasAppJsOwnProp).toBe(true)
    expect(readAppJsLength).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(outputRoot, 'custom-injected.txt'))).toBe(true)
    expect(fs.readFileSync(path.join(outputRoot, 'custom-injected.txt'), 'utf-8')).toBe('INJECTED_BY_MODIFY_BUILD_ASSETS')
    expect(fs.existsSync(path.join(outputRoot, 'to-be-deleted.txt'))).toBe(false)

    // addChunkPages this.appConfig parity assertions
    expect(seenAppConfig).toBeDefined()
    expect(seenAppConfig.subPackages?.[0]?.root).toBe('pkgA')
    expect(fs.existsSync(path.join(outputRoot, 'sub-utils.js'))).toBe(true)
    const detailJs = fs.readFileSync(path.join(outputRoot, 'pkgA/detail/index.js'), 'utf-8')
    const myJs = fs.readFileSync(path.join(outputRoot, 'pkgA/my/index.js'), 'utf-8')
    expect(detailJs).toContain('require("../../sub-utils")')
    expect(myJs).toContain('require("../../sub-utils")')
  })

  it('StaticMiniSplitChunksPlugin: isolates subCommonDeps across consecutive rebuilds without leaking stale deps', async () => {
    const workDir = createTmpDir('static-split-rebuild')
    const distDir = path.join(workDir, 'dist')
    fs.ensureDirSync(path.join(workDir, 'src/pkgA'))
    fs.ensureDirSync(path.join(workDir, 'src/pkgB'))

    const appEntry = path.join(workDir, 'src/app.js')
    fs.writeFileSync(
      path.join(workDir, 'src/app.config.js'),
      `module.exports = {
        pages: ['pages/index/index'],
        subPackages: [
          { root: 'pkgA', pages: ['p1'] },
          { root: 'pkgB', pages: ['p1'] }
        ]
      }`
    )
    fs.writeFileSync(appEntry, 'console.log("app");')
    fs.writeFileSync(path.join(workDir, 'src/shared1.js'), 'export const SHARED_ONE = "S1";')
    fs.writeFileSync(path.join(workDir, 'src/shared2.js'), 'export const SHARED_TWO = "S2";')

    const writeSubPages = (sharedFile: string, exportName: string) => {
      fs.writeFileSync(
        path.join(workDir, 'src/pkgA/p1.js'),
        `import { ${exportName} } from '../${sharedFile}'; console.log('pkgA', ${exportName});`
      )
      fs.writeFileSync(
        path.join(workDir, 'src/pkgB/p1.js'),
        `import { ${exportName} } from '../${sharedFile}'; console.log('pkgB', ${exportName});`
      )
    }

    const plugin = new StaticMiniSplitChunksPlugin({
      combination: {
        config: {
          entry: { app: [appEntry] }
        }
      },
      fileType: { style: '.wxss', config: '.json', script: '.js', templ: '.wxml', xs: '.wxs' }
    })

    const createCompiler = () => rspack({
      context: workDir,
      mode: 'development',
      devtool: false,
      entry: {
        app: './src/app.js',
        'pkgA/p1': './src/pkgA/p1.js',
        'pkgB/p1': './src/pkgB/p1.js',
      },
      output: {
        path: distDir,
        filename: '[name].js',
      },
      optimization: {
        runtimeChunk: { name: 'runtime' },
        splitChunks: {
          chunks: 'all',
          minSize: 0,
          cacheGroups: {
            ...plugin.getCacheGroups(),
          },
        },
      },
      plugins: [plugin],
    })

    const runBuild = async () => {
      const compiler = createCompiler()
      try {
        return await new Promise<any>((resolve, reject) => {
          compiler.run((err, stats) => {
            if (err) return reject(err)
            resolve(stats)
          })
        })
      } finally {
        await new Promise<void>(resolve => compiler.close(() => resolve()))
      }
    }

    // Build 1: pkgA/p1 and pkgB/p1 share shared1.js
    writeSubPages('shared1.js', 'SHARED_ONE')
    const stats1 = await runBuild()
    expect(stats1.hasErrors()).toBe(false)
    const depsAfterBuild1 = Array.from(plugin.subCommonDeps.values()).map(d => path.basename(d.resource))
    expect(depsAfterBuild1).toEqual(['shared1.js'])
    expect(fs.existsSync(path.join(distDir, 'sub-common'))).toBe(false)

    // Inject a synthetic stale entry and switch both pages to shared2.js for Build 2
    // Reusing the same StaticMiniSplitChunksPlugin instance must clear subCommonDeps on thisCompilation
    plugin.subCommonDeps.set('stale-key', {
      identifier: 'stale.js',
      resource: 'stale.js',
      chunks: new Set(['pkgA/p1', 'pkgB/p1']),
    })
    fs.rmSync(distDir, { recursive: true, force: true })
    writeSubPages('shared2.js', 'SHARED_TWO')
    const stats2 = await runBuild()
    expect(stats2.hasErrors()).toBe(false)
    const depsAfterBuild2 = Array.from(plugin.subCommonDeps.values()).map(d => path.basename(d.resource))
    expect(depsAfterBuild2).toEqual(['shared2.js'])
    expect(depsAfterBuild2).not.toContain('shared1.js')
    expect(depsAfterBuild2).not.toContain('stale.js')
    expect(plugin.subCommonChunks.get('pkgA/p1')?.size).toBe(1)
    expect(fs.existsSync(path.join(distDir, 'sub-common'))).toBe(false)
  })
})
