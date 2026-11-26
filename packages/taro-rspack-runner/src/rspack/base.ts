import path from 'node:path'

import { rspack } from '@rspack/core'
import { ReactRefreshRspackPlugin } from '@rspack/plugin-react-refresh'
import { REG_NODE_MODULES, REG_SCRIPTS, resolveMainFilePath } from '@tarojs/helper'
import { buildMultiPlatformExtensions } from '@tarojs/runner-utils'
import { BaseBundlerConfig, DEFAULT_RESOLVE_EXTENSIONS } from '@tarojs/runner-utils/bundler/config/BaseConfig'
import { type CssModuleOptionConfig, type IRule, createBundlerModule } from '@tarojs/runner-utils/bundler/config/BundlerModule'
import { type PluginArgs, type PluginDefinition, createBundlerPlugin } from '@tarojs/runner-utils/bundler/config/BundlerPlugin'
import { BaseCombination } from '@tarojs/runner-utils/bundler/config/Combination'
import { reportBuildStats } from '@tarojs/runner-utils/bundler/logHelper'
import { pick } from 'lodash'
import { RspackChain as Chain } from 'rspack-chain'

import { componentConfig } from '../utils/context'

import type { CommonBuildConfig, IH5BuildConfig, IMiniBuildConfig } from '../utils/rspack'

export { buildMultiPlatformExtensions }
export type { CssModuleOptionConfig, IRule, PluginArgs }

const SWC_COMPRESS_KEYS = [
  'arrows', 'booleans', 'collapse_vars', 'comparisons', 'computed_props',
  'conditionals', 'dead_code', 'directives', 'evaluate', 'hoist_funs',
  'hoist_props', 'hoist_vars', 'if_return', 'inline', 'loops',
  'negate_iife', 'properties', 'reduce_funcs', 'reduce_vars', 'sequences',
  'switches', 'toplevel', 'typeofs', 'unused'
]

interface RegexAliasEntry {
  regex: RegExp
  target: string
}

class BeforeResolveMultiPlatformPlugin {
  private extensions?: string[]
  private regexAliases: RegexAliasEntry[]

  constructor (options: { extensions?: string[], regexAliases?: RegexAliasEntry[] } = {}) {
    this.extensions = options.extensions
    this.regexAliases = options.regexAliases || []
  }

  public apply (compiler: any) {
    const PLUGIN_NAME = 'TaroMultiPlatformPlugin'
    compiler.hooks.compilation.tap(PLUGIN_NAME, (_compilation: any, { normalModuleFactory }: any) => {
      normalModuleFactory.hooks.beforeResolve.tap(PLUGIN_NAME, (resolveData: any) => {
        if (!resolveData?.request) return
        const request: string = resolveData.request

        for (const { regex, target } of this.regexAliases) {
          if (regex.test(request)) {
            resolveData.request = target
            return
          }
        }

        const queryIdx = request.indexOf('?')
        const cleanReq = queryIdx >= 0 ? request.slice(0, queryIdx) : request
        const querySuffix = queryIdx >= 0 ? request.slice(queryIdx) : ''
        if (!cleanReq || path.extname(cleanReq)) return

        let srcRequest: string
        if (path.isAbsolute(cleanReq)) {
          srcRequest = cleanReq
        } else if (/^\./.test(cleanReq) && resolveData.context) {
          srcRequest = path.resolve(resolveData.context, cleanReq)
        } else {
          return
        }

        if (REG_NODE_MODULES.test(srcRequest)) return
        const resolved = resolveMainFilePath(srcRequest, this.extensions)
        if (resolved && resolved !== srcRequest && resolved !== cleanReq) {
          resolveData.request = resolved + querySuffix
        }
      })
    })
  }
}

class TaroStatsReporterPlugin {
  private config: Record<string, any>

  constructor (config: Record<string, any>) {
    this.config = config
  }

  apply (compiler: any) {
    compiler.hooks.done.tap('TaroStatsReporterPlugin', (stats: any) => {
      reportBuildStats(stats, this.config)
    })
  }
}

type Config = Partial<IMiniBuildConfig | IH5BuildConfig>

const BaseRspackPlugin = createBundlerPlugin({
  bundler: rspack,
  loadModule: id => require(id),
  copyPluginClass: rspack.CopyRspackPlugin,
  cssExtractPluginClass: rspack.CssExtractRspackPlugin
})

export class RspackPlugin extends BaseRspackPlugin {
  static getSwcJsMinimizerPlugin = (terserOptions: Record<string, any> = {}): PluginDefinition => {
    const compress = terserOptions.compress === false
      ? false
      : Object.assign(
        { keep_fnames: Boolean(terserOptions.keep_fnames) },
        typeof terserOptions.compress === 'object' ? pick(terserOptions.compress, SWC_COMPRESS_KEYS) : undefined
      )

    const mangle = terserOptions.mangle === false
      ? false
      : Object.assign(
        { keep_fnames: Boolean(terserOptions.keep_fnames) },
        typeof terserOptions.mangle === 'object' ? terserOptions.mangle : undefined
      )

    const output = terserOptions.output || terserOptions.format || {}
    const format: Record<string, any> = {
      comments: output.comments ?? false,
      asciiOnly: Boolean(output.ascii_only ?? output.asciiOnly)
    }

    return BaseRspackPlugin.getPlugin(rspack.SwcJsMinimizerRspackPlugin, [{
      minimizerOptions: {
        compress,
        mangle,
        format
      }
    }])
  }

  static getTerserPlugin = (terserOptions: Record<string, any> = {}): PluginDefinition => {
    return RspackPlugin.getSwcJsMinimizerPlugin(terserOptions)
  }

  static getESBuildMinifyPlugin = (): PluginDefinition => {
    return RspackPlugin.getSwcJsMinimizerPlugin({ output: { comments: false } })
  }
}

const BaseRspackModule = createBundlerModule({
  resolveLoader: id => require.resolve(id),
  loadModule: id => require(id),
  extractCssLoader: rspack.CssExtractRspackPlugin.loader
})

export class RspackModule extends BaseRspackModule {
  static getScriptRule (onParseCreateElement?: any) {
    return {
      test: REG_SCRIPTS,
      use: {
        taroComponentCollectorLoader: RspackModule.getLoader(
          path.resolve(__dirname, '../loaders/taroComponentCollectorLoader'),
          { onParseCreateElement }
        ),
        babelLoader: RspackModule.getLoader('babel-loader', {
          compact: false
        })
      }
    }
  }
}

function createRspackChain (): Chain {
  const chain = new Chain()
  const opt = (chain as any).optimization
  if (opt?.get && opt?.splitChunks?.entries) {
    const origOptGet = opt.get.bind(opt)
    opt.get = (key: string) => {
      const val = origOptGet(key)
      if (val === undefined && key === 'splitChunks') {
        return opt.splitChunks.entries()
      }
      return val
    }
  }
  return chain
}

export function mergeRspackChain (chain: Chain, config: Record<string, any>) {
  const { optimization, ...rest } = config
  if (optimization && typeof optimization === 'object' && 'splitChunks' in optimization) {
    const { splitChunks, ...restOpt } = optimization
    chain.merge({ ...rest, optimization: restOpt })
    chain.optimization.splitChunks(splitChunks)
  } else {
    chain.merge(config)
  }
}

export class BaseConfig extends BaseBundlerConfig<Chain, Config> {
  constructor (appPath: string, config: Config) {
    super(appPath, config, createRspackChain(), {
      pluginHelper: RspackPlugin,
      extensions: buildMultiPlatformExtensions(DEFAULT_RESOLVE_EXTENSIONS),
      resolvePlugins: false
    })
    this.chain.module.parser.set('javascript', {
      reexportExportsPresence: false
    })
  }

  protected getProgressPlugins (config: Config): Record<string, PluginDefinition> {
    const plugins: Record<string, PluginDefinition> = {
      taroStatsReporter: RspackPlugin.getPlugin(TaroStatsReporterPlugin, [config])
    }
    if (config.logger?.quiet !== true && process.env.NODE_ENV !== 'test') {
      plugins.progress = RspackPlugin.getPlugin(rspack.ProgressPlugin, [{}])
    }
    return plugins
  }

  protected configureCache (_appPath: string, config: Config): void {
    if (config.cache?.enable) {
      (this.chain as any).set('cache', true)
    }
  }
}

export function normalizeChainForRspack (chain: Chain) {
  // 1. Replace Webpack-only React Refresh / HMR plugins with Rspack equivalents
  if (chain.plugins.has('fastRefreshPlugin')) {
    const p = chain.plugin('fastRefreshPlugin').get('plugin')
    const pluginName = p?.name || ''
    if (pluginName === 'ReactRefreshPlugin' || pluginName === 'PreFresh') {
      chain.plugin('fastRefreshPlugin').use(ReactRefreshRspackPlugin as any)
    }
  }
  if (chain.plugins.has('hotModuleReplacementPlugin')) {
    chain.plugin('hotModuleReplacementPlugin').use(rspack.HotModuleReplacementPlugin as any)
  }
  if (chain.plugins.has('TaroMiniHMRPlugin')) {
    chain.plugins.delete('TaroMiniHMRPlugin')
  }

  // 2. Remove enhanced-resolve plugins if user/plugin added resolve.plugin('MultiPlatformPlugin')
  const resolvePlugins = (chain.resolve as any).plugins
  if (resolvePlugins?.has?.('MultiPlatformPlugin')) {
    resolvePlugins.delete('MultiPlatformPlugin')
  }

  // 3. Extract RegExp keys out of chain.resolve.alias (e.g. from @tarojs/plugin-framework-react)
  const regexAliases: RegexAliasEntry[] = []
  const aliasEntries = chain.resolve.alias.entries() || {}
  const rawMap: Map<any, any> = (chain.resolve.alias as any).store
  if (rawMap instanceof Map) {
    for (const [key, val] of Array.from(rawMap.entries())) {
      if (val === undefined || val === null) {
        rawMap.delete(key)
      } else if (key instanceof RegExp) {
        regexAliases.push({ regex: key, target: String(val) })
        rawMap.delete(key)
      }
    }
  } else {
    for (const key of Object.keys(aliasEntries)) {
      if (aliasEntries[key] === undefined || aliasEntries[key] === null) {
        chain.resolve.alias.delete(key)
      } else if (key.startsWith('/') && key.endsWith('/')) {
        try {
          regexAliases.push({ regex: new RegExp(key.slice(1, -1)), target: String(aliasEntries[key]) })
          chain.resolve.alias.delete(key)
        } catch {
          // ignore
        }
      }
    }
  }

  // 4. Ensure multi-platform extensions + TaroMultiPlatformPlugin are registered
  const currentExts = chain.resolve.extensions.values()
  const expandedExts = buildMultiPlatformExtensions(
    currentExts.length ? currentExts : DEFAULT_RESOLVE_EXTENSIONS
  )
  chain.resolve.extensions.clear()
  expandedExts.forEach(ext => chain.resolve.extensions.add(ext))

  chain.plugin('taroMultiPlatformPlugin').use(BeforeResolveMultiPlatformPlugin as any, [{
    extensions: expandedExts,
    regexAliases
  }])
}

export class Combination<T extends IMiniBuildConfig | IH5BuildConfig = CommonBuildConfig> extends BaseCombination<T, Chain> {
  protected bundler = rspack
  protected componentConfig = componentConfig

  async post (config: T, chain: Chain) {
    await super.post(config, chain)
    normalizeChainForRspack(chain)
  }

  getPrebundleOptions () {
    return { enable: false }
  }
}
