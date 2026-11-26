import path from 'node:path'

import { META_TYPE } from '@tarojs/helper'
import {
  addRequireToSourceWith,
  collectChunkGroupDeps
} from '@tarojs/runner-utils/bundler/loadChunks'
import {
  type IBaseMiniPluginOptions,
  type IBaseMiniPluginResolvedOptions,
  type IndependentPackage,
  type MiniPluginHooks,
  baseCompName,
  BaseMiniPlugin,
  customWrapperName,
  STYLE_ISOLATION_APPLY_SHARED,
  STYLE_ISOLATION_SHARED
} from '@tarojs/runner-utils/bundler/miniPlugin'
import { sources } from 'webpack'
import EntryDependency from 'webpack/lib/dependencies/EntryDependency'

import TaroSingleEntryDependency from '../dependencies/TaroSingleEntryDependency'
import { componentConfig } from '../utils/component'
import { getChunkEntryModule, getChunkIdOrName } from '../utils/webpack'
import TaroLoadChunksPlugin from './TaroLoadChunksPlugin'
import TaroNormalModulesPlugin from './TaroNormalModulesPlugin'
import TaroSingleEntryPlugin from './TaroSingleEntryPlugin'

import type { Compilation, Compiler } from 'webpack'
import type { IComponentObj } from '../utils/types'
import type { MiniCombination } from '../webpack/MiniCombination'
import type TaroNormalModule from './TaroNormalModule'

export {
  baseCompName,
  customWrapperName,
  STYLE_ISOLATION_APPLY_SHARED,
  STYLE_ISOLATION_SHARED
}
export type { IComponentObj, IndependentPackage, MiniPluginHooks }
export type ITaroMiniPluginOptions = IBaseMiniPluginOptions<MiniCombination>
export type IOptions = IBaseMiniPluginResolvedOptions<MiniCombination>

const PLUGIN_NAME = 'TaroMiniPlugin'

function isLoaderExist (loaders: any[], loaderName: string) {
  return loaders.some(item => item.loader === loaderName)
}

export default class TaroMiniPlugin extends BaseMiniPlugin<MiniCombination, IOptions> {
  dependencies = new Map<string, TaroSingleEntryDependency>()

  public getSources (compiler?: any) {
    return (compiler || this.currentCompiler)?.webpack?.sources || sources
  }

  public getComponentConfig () {
    return componentConfig
  }

  protected getTemplateDir () {
    return path.resolve(__dirname, '..', 'template')
  }

  protected removeAppEntry () {
    for (const [key, dep] of this.dependencies.entries()) {
      if (dep.miniType === META_TYPE.ENTRY) {
        this.dependencies.delete(key)
        break
      }
    }
  }

  protected createLoadChunksPlugin () {
    const { commonChunks, combination, framework, isBuildPlugin } = this.options
    return new TaroLoadChunksPlugin({
      commonChunks,
      isBuildPlugin,
      addChunkPages: combination.config.addChunkPages,
      pages: this.pages,
      framework,
      appConfig: this.appConfig
    })
  }

  protected onMake (compiler: Compiler, compilation: Compilation, promises: Promise<null>[]) {
    this.compileIndependentPages(compiler, compilation, this.dependencies, promises)
  }

  protected onCollectMakeEntryPromises (compilation: Compilation, promises: Promise<null>[]) {
    this.dependencies.forEach(dep => {
      promises.push(new Promise<null>((resolve, reject) => {
        compilation.addEntry(this.options.sourceDir, dep, {
          name: dep.name,
          ...dep.options
        }, err => err ? reject(err) : resolve(null))
      }))
    })
  }

  protected onCompilation (compilation: Compilation, normalModuleFactory: any, compiler: Compiler) {
    compilation.dependencyFactories.set(EntryDependency, normalModuleFactory)
    compilation.dependencyFactories.set(TaroSingleEntryDependency as any, normalModuleFactory)

    compiler.webpack.NormalModule.getCompilationHooks(compilation).loader.tap(PLUGIN_NAME, (_loaderContext, module: any) => {
      const resolved = this.getEntryLoaderConfig(module.miniType, module.name, module.resource)
      if (resolved && !isLoaderExist(module.loaders, resolved.loaderName)) {
        module.loaders.unshift({
          loader: resolved.loaderName,
          options: resolved.options
        })
      }
    })
  }

  protected applyExtraCompilerPlugins (compiler: Compiler) {
    new TaroNormalModulesPlugin(this.options.combination.config.onParseCreateElement).apply(compiler)
  }

  addLoadChunksPlugin (compiler: Compiler) {
    let fileChunks = new Map<string, { name: string }[]>()

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
      compilation.hooks.afterOptimizeChunks.tap(PLUGIN_NAME, chunks => {
        fileChunks = collectChunkGroupDeps(chunks, this.options.commonChunks, getChunkIdOrName)
      })
      compiler.webpack.javascript.JavascriptModulesPlugin.getCompilationHooks(compilation).render.tap(PLUGIN_NAME, (modules, { chunk }) => {
        const chunkEntryModule = getChunkEntryModule(compilation, chunk) as any
        if (!chunkEntryModule) return
        const entryModule: TaroNormalModule = chunkEntryModule.rootModule ?? chunkEntryModule
        if (fileChunks.size) {
          let source
          const id = getChunkIdOrName(chunk)
          const { miniType } = entryModule as any

          const modifyResult = this.hooks.modifyChunkRequire.call({ source: modules, handled: false }, id, miniType)
          if (modifyResult?.handled) {
            return modifyResult.source
          }

          const { ConcatSource } = this.getSources(compiler)
          const entryChunk = [{ name: 'app' }]
          if (this.nativeComponents.has(id) || miniType === META_TYPE.STATIC) {
            fileChunks.forEach((v, k) => {
              if (k === id) {
                source = addRequireToSourceWith(ConcatSource, id, modules, v)
              }
            })
            return source || modules
          } else if (miniType === META_TYPE.PAGE) {
            return addRequireToSourceWith(ConcatSource, id, modules, entryChunk)
          }
        }
      })
    })
  }

  computeForceCustomWrapperForWebpackMainComp (): boolean {
    return this.computeForceCustomWrapperForMainComp()
  }

  getConfigFiles (compiler: Compiler) {
    super.getConfigFiles(compiler)
    const filesConfig = this.filesConfig

    // webpack createChunkAssets 前一刻，去除所有 config chunks
    compiler.hooks.compilation.tap(PLUGIN_NAME, compilation => {
      compilation.hooks.beforeChunkAssets.tap(PLUGIN_NAME, () => {
        const chunks = compilation.chunks
        const configNames = Object.keys(filesConfig)

        for (const chunk of chunks) {
          if (configNames.find(configName => configName === chunk.name)) chunks.delete(chunk)
        }
      })
    })
  }

  addEntry (entryPath: string, entryName: string, entryType: META_TYPE, options = {}) {
    let dep: TaroSingleEntryDependency
    const depKey = entryType === META_TYPE.STATIC ? `${entryPath}#${entryName}` : entryPath
    if (this.dependencies.has(depKey)) {
      dep = this.dependencies.get(depKey)!
      dep.name = entryName
      dep.loc = { name: entryName }
      dep.request = entryPath
      dep.userRequest = entryPath
      dep.miniType = entryType
      dep.options = options
    } else {
      dep = new TaroSingleEntryDependency(entryPath, entryName, { name: entryName }, entryType, options)
    }
    this.dependencies.set(depKey, dep)
  }

  compileIndependentPages (compiler, compilation, dependencies, promises) {
    if (!this.independentPackages.size) return

    const JsonpTemplatePlugin = require('webpack/lib/web/JsonpTemplatePlugin')
    const NaturalChunkIdsPlugin = require('webpack/lib/ids/NaturalChunkIdsPlugin')
    const SplitChunksPlugin = require('webpack/lib/optimize/SplitChunksPlugin')
    const RuntimeChunkPlugin = require('webpack/lib/optimize/RuntimeChunkPlugin')
    const MiniCssExtractPlugin = require('mini-css-extract-plugin')

    this.compileIndependentPagesWith(compiler, compilation, promises, {
      setChildOutputFileSystem: true,
      setChildOutputPath: true,
      applyChildBasePlugins: childCompiler => {
        new JsonpTemplatePlugin().apply(childCompiler)
        new NaturalChunkIdsPlugin().apply(childCompiler)
        new MiniCssExtractPlugin({
          filename: `[name]${this.options.fileType.style}`,
          chunkFilename: `[name]${this.options.fileType.style}`
        }).apply(childCompiler)
      },
      SplitChunksPlugin,
      RuntimeChunkPlugin,
      takeEntryForIndependent: entryPath => {
        if (!dependencies.has(entryPath)) return undefined
        const dep = dependencies.get(entryPath)
        dependencies.delete(entryPath)
        return {
          request: dep.request,
          name: dep.name,
          miniType: dep.miniType,
          options: dep.options
        }
      },
      addChildEntry: (childCompiler, parentCompiler, entry) => {
        new TaroSingleEntryPlugin(
          parentCompiler.context,
          entry.request,
          entry.name,
          entry.miniType,
          entry.options
        ).apply(childCompiler)
      },
      createChildLoadChunksPlugin: ({ commonChunks, pages, needAddCommon }) => {
        return new TaroLoadChunksPlugin({
          commonChunks,
          isBuildPlugin: false,
          addChunkPages: this.options.combination.config.addChunkPages,
          pages,
          framework: this.options.framework,
          isIndependentPackages: true,
          needAddCommon,
          appConfig: this.appConfig
        })
      }
    })
  }

  addTarBarFilesToDependencies (compilation: Compilation) {
    this.addTabBarFilesToDependencies(compilation)
  }
}
