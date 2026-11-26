import {
  BaseLoadChunksPlugin,
  transformEntryChunkSource
} from '@tarojs/runner-utils/bundler/loadChunks'

import { componentConfig } from '../utils/component'
import { chunkHasJs, getChunkEntryModule, getChunkIdOrName } from '../utils/webpack'

import type { Chunk, Compilation, Compiler, sources } from 'webpack'
import type TaroNormalModule from './TaroNormalModule'

const PLUGIN_NAME = 'TaroLoadChunksPlugin'

export default class TaroLoadChunksPlugin extends BaseLoadChunksPlugin {
  apply (compiler: Compiler) {
    const addChunkPagesList = new Map<string, string[]>()
    const { ConcatSource } = compiler.webpack.sources
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation: Compilation) => {
      let commonChunks: Chunk[] = []
      let fileChunks = new Map<string, { name: string }[]>()

      compilation.hooks.afterOptimizeChunks.tap(PLUGIN_NAME, (chunks: Chunk[]) => {
        const chunksArray = Array.from(chunks)
        /**
         * 收集 common chunks 中使用到 @tarojs/components 中的组件
         */
        commonChunks = chunksArray.filter(chunk => this.commonChunks.includes(chunk.name!) && chunkHasJs(chunk, compilation.chunkGraph)).reverse()

        this.collectComponentsFromChunks(
          compilation,
          chunksArray,
          commonChunks,
          componentConfig,
          compiler.webpack.util.comparators.compareModulesByIdentifier
        )

        /**
         * 收集开发者在 addChunkPages 中配置的页面及其需要引用的公共文件
         */
        fileChunks = this.collectAddChunkPagesDeps(
          chunksArray,
          getChunkIdOrName,
          addChunkPagesList
        )
      })

      /**
       * 在每个 chunk 文本刚生成后，按判断条件在文本头部插入 module.exports / require 语句
       */
      compiler.webpack.javascript.JavascriptModulesPlugin.getCompilationHooks(compilation).render.tap(PLUGIN_NAME, (modules: sources.ConcatSource, { chunk }) => {
        const chunkEntryModule = getChunkEntryModule(compilation, chunk) as any
        if (!chunkEntryModule) { return modules }

        const entryModule: TaroNormalModule = chunkEntryModule.rootModule ?? chunkEntryModule
        return transformEntryChunkSource({
          chunkName: getChunkIdOrName(chunk),
          miniType: entryModule.miniType,
          isNativePage: entryModule.isNativePage,
          source: modules,
          commonChunks,
          fileChunks,
          isBuildPlugin: this.isBuildPlugin,
          needAddCommon: this.needAddCommon,
          isIndependentPackages: this.isIndependentPackages,
          appConfig: this.appConfig,
          ConcatSource
        })
      })
    })
  }
}
