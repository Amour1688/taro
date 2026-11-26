import {
  type IBaseLoadChunksPluginOptions,
  BaseLoadChunksPlugin,
  chunkHasJs,
  getChunkIdOrName,
  transformEntryChunkSource
} from '@tarojs/runner-utils/bundler/loadChunks'

import { componentConfig } from '../utils/context'

import type { Chunk, Compilation, Compiler } from '@rspack/core'
import type { META_TYPE } from '@tarojs/helper'

const PLUGIN_NAME = 'TaroLoadChunksPlugin'

export interface ITaroLoadChunksEntryMeta {
  name: string
  miniType: META_TYPE
  isNativePage?: boolean
}

export interface ITaroLoadChunksPluginOptions extends IBaseLoadChunksPluginOptions {
  entryMetaMap: Map<string, ITaroLoadChunksEntryMeta>
}

export default class TaroLoadChunksPlugin extends BaseLoadChunksPlugin {
  entryMetaMap: Map<string, ITaroLoadChunksEntryMeta>

  constructor (options: ITaroLoadChunksPluginOptions) {
    super(options)
    this.entryMetaMap = options.entryMetaMap
  }

  apply (compiler: Compiler) {
    const addChunkPagesList = new Map<string, string[]>()
    const { ConcatSource } = compiler.webpack.sources

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation: Compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: `${PLUGIN_NAME}_CollectComponents`,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL - 1
        },
        () => {
          const chunksArray = Array.from(compilation.chunks) as Chunk[]
          const commonChunks = chunksArray
            .filter(chunk => Boolean(chunk.name && this.commonChunks.includes(chunk.name) && chunkHasJs(chunk, compilation)))
            .reverse()

          this.collectComponentsFromChunks(compilation, chunksArray, commonChunks, componentConfig)
        }
      )

      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          const chunksArray = Array.from(compilation.chunks) as Chunk[]
          const activeCommonChunks = this.getActiveCommonChunks(chunksArray, compilation)
          const fileChunks = this.collectAddChunkPagesDeps(
            chunksArray,
            getChunkIdOrName,
            addChunkPagesList
          )

          for (const chunk of chunksArray) {
            const chunkName = getChunkIdOrName(chunk)
            const entryMeta = this.entryMetaMap.get(chunkName)
            if (!entryMeta) continue

            const jsAssetName = `${chunkName}.js`
            const currentAsset = compilation.assets[jsAssetName]
            if (!currentAsset) continue

            const updatedSource = transformEntryChunkSource({
              chunkName,
              miniType: entryMeta.miniType,
              isNativePage: entryMeta.isNativePage,
              source: currentAsset,
              commonChunks: activeCommonChunks,
              fileChunks,
              isBuildPlugin: this.isBuildPlugin,
              needAddCommon: this.needAddCommon,
              isIndependentPackages: this.isIndependentPackages,
              appConfig: this.appConfig,
              ConcatSource
            })

            if (updatedSource !== currentAsset) {
              compilation.assets[jsAssetName] = updatedSource
            }
          }
        }
      )
    })
  }
}
