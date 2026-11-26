import {
  addRequireToSourceWith,
  collectChunkGroupDeps
} from '@tarojs/runner-utils/bundler/loadChunks'
import { createBuildNativePluginClass } from '@tarojs/runner-utils/bundler/miniPlugin'

import { getChunkEntryModule, getChunkIdOrName } from '../utils/webpack'
import MiniPlugin from './MiniPlugin'

import type { Compiler } from 'webpack'

const PLUGIN_NAME = 'BuildNativePlugin'

export default class BuildNativePlugin extends createBuildNativePluginClass(MiniPlugin) {
  protected onAfterBuildNativeRun (compiler: Compiler) {
    this.addLoader(compiler)
  }

  addLoadChunksPlugin (compiler: Compiler) {
    let fileChunks = new Map<string, { name: string }[]>()

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
      compilation.hooks.afterOptimizeChunks.tap(PLUGIN_NAME, chunks => {
        fileChunks = collectChunkGroupDeps(chunks, this.options.commonChunks, getChunkIdOrName)
      })
      compiler.webpack.javascript.JavascriptModulesPlugin.getCompilationHooks(compilation).render.tap(PLUGIN_NAME, (modules, { chunk }) => {
        if (!getChunkEntryModule(compilation, chunk)) return modules

        if (fileChunks.size) {
          let source
          const id = getChunkIdOrName(chunk)
          fileChunks.forEach((v, k) => {
            if (k === id) {
              source = addRequireToSourceWith(this.getSources(compiler).ConcatSource, id, modules, v)
            }
          })
          return source
        }
      })
    })
  }

  // 加载 taro-runtime 前必须先加载端平台插件的 runtime
  addLoader (compiler: Compiler) {
    compiler.hooks.compilation.tap(PLUGIN_NAME, compilation => {
      compiler.webpack.NormalModule.getCompilationHooks(compilation).loader.tap(PLUGIN_NAME, (_loaderContext, module: any) => {
        if (module.rawRequest === '@tarojs/runtime') {
          module.loaders.unshift({
            loader: '@tarojs/taro-loader/lib/taro-runtime',
            options: {
              runtimePath: this.options.runtimePath
            }
          })
        }
      })
    })
  }
}
