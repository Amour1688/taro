import {
  collectModuleComponentMetaFromAst,
  syncCachedComponentNames
} from '@tarojs/runner-utils/bundler/componentCollector'

import TaroSingleEntryDependency from '../dependencies/TaroSingleEntryDependency'
import { componentConfig, componentNameSet, elementNameSet } from '../utils/component'
import TaroNormalModule, { TaroBaseNormalModule } from './TaroNormalModule'

import type { Func } from '@tarojs/taro/types/compile'
import type AcornWalk from 'acorn-walk'
import type { Compiler } from 'webpack'

const walk = require('acorn-walk') as typeof AcornWalk

const PLUGIN_NAME = 'TaroNormalModulesPlugin'

export default class TaroNormalModulesPlugin {
  isCache = true

  onParseCreateElement: Func | undefined

  constructor (onParseCreateElement: Func | undefined) {
    this.onParseCreateElement = onParseCreateElement
  }

  apply (compiler: Compiler) {
    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation, { normalModuleFactory }) => {
      // cache 开启后，会跳过 JavaScript parser 环节，因此需要收集组件信息，在 finishModules 阶段处理
      compilation.hooks.finishModules.tap(PLUGIN_NAME, (_) => {
        if (!this.isCache) return

        syncCachedComponentNames(
          elementNameSet as Iterable<string>,
          componentNameSet as Iterable<string>,
          componentConfig,
          this.onParseCreateElement
        )
      })

      normalModuleFactory.hooks.createModule.tapPromise(PLUGIN_NAME, (data, { dependencies }) => {
        const dependency = dependencies[0]
        if (dependency instanceof TaroSingleEntryDependency) {
          return Promise.resolve(new TaroNormalModule(Object.assign(data,
            { miniType: dependency.miniType, name: dependency.name, isNativePage: dependency.options.isNativePage }
          )))
        }
        return Promise.resolve(new TaroBaseNormalModule(data))
      })

      // react 的第三方组件支持
      normalModuleFactory.hooks.parser.for('javascript/auto').tap(PLUGIN_NAME, (parser) => {
        parser.hooks.program.tap(PLUGIN_NAME, (ast) => {
          this.isCache = false

          const currentModule = parser.state.current as TaroBaseNormalModule
          currentModule.clear()

          collectModuleComponentMetaFromAst(ast, walk, {
            target: currentModule,
            componentConfig,
            onParseCreateElement: this.onParseCreateElement
          })
        })
      })
    })
  }
}
