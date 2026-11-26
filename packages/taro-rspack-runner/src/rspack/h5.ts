import { rspack } from '@rspack/core'
import { REG_SCRIPTS } from '@tarojs/helper'
import { getDefaultH5TerserOptions } from '@tarojs/runner-utils'
import { type IRule } from '@tarojs/runner-utils/bundler/config/BundlerModule'
import { getH5ResolveConfig } from '@tarojs/runner-utils/bundler/config/H5BaseConfig'
import { applyH5CombinationProcess } from '@tarojs/runner-utils/bundler/config/H5Combination'
import { BaseH5Module } from '@tarojs/runner-utils/bundler/config/H5Module'
import { BaseH5PluginConfig } from '@tarojs/runner-utils/bundler/config/H5PluginConfig'
import { BaseH5Plugin, resolveH5EntryLoaderConfig } from '@tarojs/runner-utils/bundler/h5Plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'

import { componentConfig } from '../utils/context'
import { BaseConfig, Combination, mergeRspackChain, RspackModule, RspackPlugin } from './base'

import type { Compiler } from '@rspack/core'
import type AppHelper from '@tarojs/runner-utils/bundler/app'
import type { IH5BuildConfig } from '../utils/rspack'

class TaroH5Plugin extends BaseH5Plugin {
  protected applyBundlerHooks (compiler: Compiler) {
    const rules = (compiler.options.module.rules ||= [])
    rules.push({
      test: REG_SCRIPTS,
      enforce: 'pre',
      include: [this.options.sourceDir],
      use: (info: any) => {
        const resourcePath = info?.resource
        const resolved = resolveH5EntryLoaderConfig(
          resourcePath,
          this.appHelper,
          this.options,
          id => require.resolve(id)
        )
        return resolved
          ? [{ ident: `taro-h5-entry:${resourcePath}`, loader: resolved.loader, options: resolved.options }]
          : []
      }
    })
  }
}

export class H5BaseConfig extends BaseConfig {
  defaultTerserOptions = getDefaultH5TerserOptions()

  constructor (appPath: string, config: Partial<IH5BuildConfig>) {
    super(appPath, config)
    this.chain.merge({
      resolve: getH5ResolveConfig(appPath, config.mode, id => require.resolve(id))
    })
    this.setMinimizer(config, this.defaultTerserOptions)
  }
}

export class H5RspackPlugin extends BaseH5PluginConfig<H5Combination> {
  protected getPluginHelper () {
    return RspackPlugin
  }

  protected getHtmlWebpackPluginClass () {
    return HtmlWebpackPlugin
  }

  protected getMainPluginClass () {
    return TaroH5Plugin
  }
}

export class H5RspackModule extends BaseH5Module<H5Combination> {
  protected getModuleClass () {
    return RspackModule
  }

  protected getBaseScriptRule (): IRule {
    return RspackModule.getScriptRule(this.combination.config.onParseCreateElement)
  }
}

export class H5Combination extends Combination<IH5BuildConfig> {
  appHelper: AppHelper
  rspackPlugin = new H5RspackPlugin(this)
  rspackModule = new H5RspackModule(this)

  isMultiRouterMode = false
  isVirtualEntry = false
  noInjectGlobalStyle = false

  constructor (appPath: string, config: IH5BuildConfig) {
    super(appPath, config)
    this.noInjectGlobalStyle = !!config.noInjectGlobalStyle
  }

  process (config: Partial<IH5BuildConfig>) {
    applyH5CombinationProcess({
      combination: this,
      config,
      baseConfig: new H5BaseConfig(this.appPath, config),
      bundlerPlugin: this.rspackPlugin,
      bundlerModule: this.rspackModule,
      componentConfig,
      getVirtualModulePlugin: () => rspack.experiments.VirtualModulesPlugin,
      getPlugin: RspackPlugin.getPlugin,
      mergeChain: mergeRspackChain
    })
  }
}
