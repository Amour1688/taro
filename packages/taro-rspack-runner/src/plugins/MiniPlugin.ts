import { META_TYPE, SCRIPT_EXT } from '@tarojs/helper'
import {
  addRequireToSourceWith,
  collectChunkGroupDeps,
  getChunkIdOrName
} from '@tarojs/runner-utils/bundler/loadChunks'
import {
  type IBaseMiniPluginOptions,
  type IBaseMiniPluginResolvedOptions,
  BaseMiniPlugin,
  createBuildNativePluginClass
} from '@tarojs/runner-utils/bundler/miniPlugin'

import {
  buildEntryRequestWithQuery,
  componentConfig,
  parseEntryNameFromQuery,
  TARO_ENTRY_QUERY_KEY
} from '../utils/context'
import { wrapAssetsForModifyHook } from '../utils/rspack'
import TaroLoadChunksPlugin from './TaroLoadChunksPlugin'

import type { Compilation, Compiler } from '@rspack/core'
import type { MiniCombination } from '../rspack/mini'

const PLUGIN_NAME = 'TaroMiniPlugin'
const BUILD_NATIVE_PLUGIN_NAME = 'BuildNativePlugin'

export interface IMiniEntryMeta {
  name: string
  entryPath: string
  miniType: META_TYPE
  options: Record<string, any>
  isNativePage?: boolean
}

export type ITaroMiniPluginOptions = IBaseMiniPluginOptions<MiniCombination>
export type IOptions = IBaseMiniPluginResolvedOptions<MiniCombination>

export default class TaroMiniPlugin extends BaseMiniPlugin<MiniCombination, IOptions> {
  entryMetaMap = new Map<string, IMiniEntryMeta>()
  entryKeyMap = new Map<string, IMiniEntryMeta>()

  constructor (options: ITaroMiniPluginOptions) {
    super(options)
    if (!this.options.frameworkExts.length) {
      this.options.frameworkExts = SCRIPT_EXT
    }
  }

  apply (compiler: Compiler) {
    const config = this.options.combination.config
    const origModifyBuildAssets = config.modifyBuildAssets
    if (typeof origModifyBuildAssets === 'function') {
      config.modifyBuildAssets = (assets: any, miniPlugin: any) =>
        origModifyBuildAssets(wrapAssetsForModifyHook(assets), miniPlugin)
    }
    try {
      super.apply(compiler)
    } finally {
      if (typeof origModifyBuildAssets === 'function') {
        config.modifyBuildAssets = origModifyBuildAssets
      }
    }
  }

  public getComponentConfig () {
    return componentConfig
  }

  async optimizeMiniFiles (compilation: any, compiler: any) {
    await super.optimizeMiniFiles(compilation, compiler)
    Object.keys(this.filesConfig).forEach(name => {
      delete compilation.assets[`${name}.js`]
      delete compilation.assets[`${name}.js.map`]
    })
  }

  protected onBeforeRun () {
    super.onBeforeRun()
    this.entryMetaMap.clear()
    this.entryKeyMap.clear()
  }

  protected removeAppEntry () {
    for (const [key, dep] of this.entryKeyMap.entries()) {
      if (dep.miniType === META_TYPE.ENTRY) {
        this.entryKeyMap.delete(key)
        this.entryMetaMap.delete(dep.name)
        break
      }
    }
  }

  private getEntryRequest (meta: IMiniEntryMeta): string {
    const needsEntryLoader =
      meta.miniType === META_TYPE.ENTRY ||
      meta.miniType === META_TYPE.PAGE ||
      meta.miniType === META_TYPE.COMPONENT
    return needsEntryLoader
      ? buildEntryRequestWithQuery(meta.entryPath, meta.name)
      : meta.entryPath
  }

  protected createLoadChunksPlugin () {
    const { commonChunks, combination, framework, isBuildPlugin } = this.options
    return new TaroLoadChunksPlugin({
      commonChunks,
      isBuildPlugin,
      addChunkPages: combination.config.addChunkPages,
      pages: this.pages,
      framework,
      appConfig: this.appConfig,
      entryMetaMap: this.entryMetaMap
    })
  }

  protected applyEntryHooks (compiler: Compiler) {
    // Rspack 2.3.4 panics in Rust if compilation.addEntry is called while compiler.options.entry is empty
    // and no EntryPlugin/DynamicEntryPlugin has registered the native entry dependency factory.
    new compiler.webpack.DynamicEntryPlugin(this.options.sourceDir, async () => ({})).apply(compiler)

    // Inject Mini entry loader via function-valued rule.use(info) (Rspack 2.3.4 ignores mutations
    // to module.loaders in NormalModule.getCompilationHooks(compilation).loader).
    compiler.options.module ||= {} as any
    compiler.options.module.rules ||= []
    compiler.options.module.rules.push({
      enforce: 'post',
      use: (info: any) => {
        const resourceQuery = info?.resourceQuery || ''
        if (!resourceQuery.includes(TARO_ENTRY_QUERY_KEY)) return []
        // Skip vue-loader virtual sub-requests (e.g. ?vue&type=template / script / style)
        // which inherit the parent .vue entry's resourceQuery.
        if (/[?&]vue(&|=|$)/.test(resourceQuery)) return []

        const entryName = parseEntryNameFromQuery(resourceQuery)
        if (!entryName) return []

        const meta = this.entryMetaMap.get(entryName)
        if (!meta) return []

        const resourcePath = meta.entryPath || (info.resource || '').replace(/\?.*$/, '')
        const resolved = this.getEntryLoaderConfig(meta.miniType, meta.name, resourcePath)
        if (!resolved) return []

        return [{
          ident: `taro-mini-entry:${meta.name}`,
          loader: require.resolve(resolved.loaderName),
          options: resolved.options
        }]
      }
    })
  }

  protected onMake (compiler: Compiler, compilation: Compilation, promises: Promise<null>[]) {
    this.compileIndependentPagesWith(compiler, compilation, promises, {
      setChildOutputFileSystem: false,
      setChildOutputPath: false,
      applyChildBasePlugins: (childCompiler, parentCompiler) => {
        const { web, CssExtractRspackPlugin } = parentCompiler.webpack
        new web.JsonpTemplatePlugin().apply(childCompiler)
        new CssExtractRspackPlugin({
          filename: `[name]${this.options.fileType.style}`,
          chunkFilename: `[name]${this.options.fileType.style}`
        }).apply(childCompiler)
      },
      SplitChunksPlugin: compiler.webpack.optimize.SplitChunksPlugin,
      RuntimeChunkPlugin: compiler.webpack.optimize.RuntimeChunkPlugin,
      takeEntryForIndependent: entryPath => {
        const meta = this.entryKeyMap.get(entryPath)
        if (!meta) return undefined
        this.entryKeyMap.delete(entryPath)
        return {
          request: this.getEntryRequest(meta),
          name: meta.name,
          miniType: meta.miniType,
          options: meta.options
        }
      },
      addChildEntry: (childCompiler, parentCompiler, entry) => {
        if (!this.entryMetaMap.has(entry.name)) {
          this.entryMetaMap.set(entry.name, {
            name: entry.name,
            entryPath: entry.request,
            miniType: entry.miniType,
            options: entry.options || {},
            isNativePage: Boolean(entry.options?.isNativePage)
          })
        }
        const validOptions = { ...(entry.options || {}) }
        delete validOptions.isNativePage
        new parentCompiler.webpack.EntryPlugin(
          parentCompiler.context,
          entry.request,
          { name: entry.name, ...validOptions }
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
          appConfig: this.appConfig,
          entryMetaMap: this.entryMetaMap
        })
      }
    })
  }

  protected onCollectMakeEntryPromises (compilation: Compilation, promises: Promise<null>[]) {
    const { EntryPlugin } = compilation.compiler.webpack
    this.entryKeyMap.forEach(meta => {
      const request = this.getEntryRequest(meta)
      const validEntryOptions = { ...meta.options }
      delete validEntryOptions.isNativePage
      const entryOptions = {
        name: meta.name,
        ...validEntryOptions
      }
      const dep = EntryPlugin.createDependency(request)
      promises.push(new Promise<null>((resolve, reject) => {
        compilation.addEntry(this.options.sourceDir, dep, entryOptions, err => err ? reject(err) : resolve(null))
      }))
    })
  }

  protected tapEntryChunkRequires (
    compiler: Compiler,
    pluginName: string,
    stageName: string,
    onEntry: (params: {
      id: string
      entryMeta: IMiniEntryMeta
      modules: any
      deps?: { name: string }[]
    }) => any
  ) {
    compiler.hooks.thisCompilation.tap(pluginName, compilation => {
      compilation.hooks.processAssets.tap(
        {
          name: stageName,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          const fileChunks = collectChunkGroupDeps(compilation.chunks, this.options.commonChunks, getChunkIdOrName)
          if (!fileChunks.size) return

          for (const chunk of compilation.chunks) {
            const id = getChunkIdOrName(chunk)
            const entryMeta = this.entryMetaMap.get(id)
            const jsAssetName = `${id}.js`
            const modules = compilation.assets[jsAssetName]
            if (!entryMeta || !modules) continue

            const nextSource = onEntry({ id, entryMeta, modules, deps: fileChunks.get(id) })
            if (nextSource && nextSource !== modules) {
              compilation.assets[jsAssetName] = nextSource
            }
          }
        }
      )
    })
  }

  protected addLoadChunksPlugin (compiler: Compiler) {
    const { ConcatSource } = this.getSources(compiler)
    this.tapEntryChunkRequires(compiler, PLUGIN_NAME, `${PLUGIN_NAME}_LoadChunks`, ({ id, entryMeta, modules, deps }) => {
      const { miniType } = entryMeta
      const modifyResult = this.hooks.modifyChunkRequire.call({ source: modules, handled: false }, id, miniType)
      if (modifyResult?.handled) return modifyResult.source

      if (this.nativeComponents.has(id) || miniType === META_TYPE.STATIC) {
        return deps ? addRequireToSourceWith(ConcatSource, id, modules, deps) : undefined
      }
      if (miniType === META_TYPE.PAGE) {
        return addRequireToSourceWith(ConcatSource, id, modules, [{ name: 'app' }])
      }
    })
  }

  addEntry (entryPath: string, entryName: string, entryType: META_TYPE, options: Record<string, any> = {}) {
    const depKey = entryType === META_TYPE.STATIC ? `${entryPath}#${entryName}` : entryPath
    const meta: IMiniEntryMeta = {
      name: entryName,
      entryPath,
      miniType: entryType,
      options,
      isNativePage: Boolean(options.isNativePage)
    }
    this.entryKeyMap.set(depKey, meta)
    this.entryMetaMap.set(entryName, meta)
  }
}

export class BuildNativePlugin extends createBuildNativePluginClass(TaroMiniPlugin) {
  protected addLoadChunksPlugin (compiler: Compiler) {
    const { ConcatSource } = this.getSources(compiler)
    this.tapEntryChunkRequires(compiler, BUILD_NATIVE_PLUGIN_NAME, BUILD_NATIVE_PLUGIN_NAME, ({ id, modules, deps }) => {
      return deps ? addRequireToSourceWith(ConcatSource, id, modules, deps) : undefined
    })
  }
}
