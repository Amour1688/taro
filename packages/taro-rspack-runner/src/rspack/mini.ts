import { getDefaultMiniTerserOptions } from '@tarojs/runner-utils'
import { BaseBuildNativePluginConfig } from '@tarojs/runner-utils/bundler/config/BuildNativePlugin'
import { type IRule } from '@tarojs/runner-utils/bundler/config/BundlerModule'
import { getMiniBaseConfigMerge } from '@tarojs/runner-utils/bundler/config/MiniBaseConfig'
import { applyMiniCombinationProcess } from '@tarojs/runner-utils/bundler/config/MiniCombination'
import { BaseMiniModule } from '@tarojs/runner-utils/bundler/config/MiniModule'
import { BaseMiniPluginConfig } from '@tarojs/runner-utils/bundler/config/MiniPluginConfig'
import { StaticMiniSplitChunksPlugin } from '@tarojs/runner-utils/bundler/splitChunks'

import MiniPlugin, { BuildNativePlugin } from '../plugins/MiniPlugin'
import { componentConfig } from '../utils/context'
import { BaseConfig, Combination, mergeRspackChain, RspackModule, RspackPlugin } from './base'

import type { EntryObject } from '@rspack/core'
import type { IFileType, IMiniBuildConfig } from '../utils/rspack'

export class MiniBaseConfig extends BaseConfig {
  defaultTerserOptions = getDefaultMiniTerserOptions()

  constructor (appPath: string, config: Partial<IMiniBuildConfig>) {
    super(appPath, config)
    this.chain.merge(getMiniBaseConfigMerge(appPath, require.resolve('regenerator-runtime'), id => require.resolve(id)))
    this.setMinimizer(config, this.defaultTerserOptions)
  }
}

export class MiniRspackPlugin extends BaseMiniPluginConfig<MiniCombination> {
  splitChunksInstance?: StaticMiniSplitChunksPlugin

  protected getPluginHelper () {
    return RspackPlugin
  }

  getMiniSplitChunksPlugin () {
    const { fileType, optimizeMainPackage } = this.combination
    if (!optimizeMainPackage?.enable) return

    this.splitChunksInstance = new StaticMiniSplitChunksPlugin({
      ...optimizeMainPackage,
      fileType,
      combination: this.combination
    })
    const instance = this.splitChunksInstance
    return RspackPlugin.getPlugin(
      class BoundMiniSplitChunksPlugin {
        apply (compiler: any) {
          instance.apply(compiler)
        }
      },
      []
    )
  }

  protected getMiniPluginClass (isBuildNativeComp: boolean) {
    return isBuildNativeComp ? BuildNativePlugin : MiniPlugin
  }
}

export class MiniRspackModule extends BaseMiniModule<MiniCombination> {
  protected getModuleClass () {
    return RspackModule
  }

  protected getBaseScriptRule (): IRule {
    return RspackModule.getScriptRule(this.combination.config.onParseCreateElement)
  }

  protected getExtraRules (): Record<string, IRule> {
    if (!this.combination.isBuildNativeComp) return {}
    return {
      taroRuntime: {
        test: /@tarojs[\\/]runtime/,
        enforce: 'post',
        use: [RspackModule.getLoader('@tarojs/taro-loader/lib/taro-runtime', {
          runtimePath: this.combination.config.runtimePath
        })]
      }
    }
  }
}

export class MiniCombination extends Combination<IMiniBuildConfig> {
  buildNativePlugin: BaseBuildNativePluginConfig<MiniCombination, EntryObject>
  fileType: IFileType
  isBuildPlugin = false
  optimizeMainPackage: { enable?: boolean, exclude?: any[] } = {
    enable: true
  }

  process (config: Partial<IMiniBuildConfig>) {
    applyMiniCombinationProcess({
      combination: this,
      config,
      baseConfig: new MiniBaseConfig(this.appPath, config),
      createBuildNativePlugin: () => new BaseBuildNativePluginConfig<MiniCombination, EntryObject>(this),
      createMiniPlugin: () => new MiniRspackPlugin(this),
      createMiniModule: () => new MiniRspackModule(this),
      componentConfig,
      mergeChain: mergeRspackChain
    })
  }
}
