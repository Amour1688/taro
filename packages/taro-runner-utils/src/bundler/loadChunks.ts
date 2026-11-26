import path from 'node:path'

import { META_TYPE, promoteRelativePath, taroJsComponents } from '@tarojs/helper'
import { toDashed } from '@tarojs/shared'

import type { AppConfig } from '@tarojs/taro'
import type { IComponentConfig } from '@tarojs/taro/types/compile/hooks'
import type { AddPageChunks, IBundlerSources, IComponent } from './types'

export function getChunkIdOrName (chunk: any): string {
  if (chunk?.name) {
    return chunk.name
  }
  if (typeof chunk?.id === 'string') {
    return chunk.id
  }
  return String(chunk?.id ?? '')
}

export function chunkHasJs (chunk: any, chunkGraphOrCompilation: any): boolean {
  if (!chunk) return false
  if (chunk.files) {
    for (const file of chunk.files) {
      if (typeof file === 'string' && file.endsWith('.js')) return true
    }
  }
  const compilation = chunkGraphOrCompilation?.chunkGraph ? chunkGraphOrCompilation : undefined
  const chunkGraph = compilation ? compilation.chunkGraph : chunkGraphOrCompilation
  if (chunk.name && compilation?.assets?.[`${chunk.name}.js`]) {
    return true
  }
  if (chunk.name) {
    if (chunk.name === chunk.runtime) return true
    if (typeof chunk.runtime?.has === 'function' && chunk.runtime.has(chunk.name)) return true
  }
  if (typeof chunkGraph?.getNumberOfEntryModules === 'function' && chunkGraph.getNumberOfEntryModules(chunk) > 0) {
    return true
  }
  if (typeof chunkGraph?.getChunkModulesIterableBySourceType === 'function') {
    const jsModules = chunkGraph.getChunkModulesIterableBySourceType(chunk, 'javascript')
    const iterator = jsModules?.[Symbol.iterator]?.()
    if (iterator && !iterator.next().done) {
      return true
    }
  }
  return false
}

export function collectChunkGroupDeps (
  chunks: Iterable<any>,
  commonChunks: string[],
  getChunkId: (chunk: any) => string = getChunkIdOrName
): Map<string, { name: string }[]> {
  const fileChunks = new Map<string, { name: string }[]>()
  for (const chunk of chunks) {
    const id = getChunkId(chunk)
    if (commonChunks.includes(id)) continue

    const deps: { name: string }[] = []
    for (const group of chunk.groupsIterable || []) {
      group.chunks.forEach((c: any) => {
        const currentChunkId = getChunkId(c)
        if (id === currentChunkId) return
        deps.push({ name: currentChunkId })
      })
    }
    fileChunks.set(id, deps)
  }
  return fileChunks
}

/**
 * 在文本头部加入一些 require 语句
 */
export function addRequireToSourceWith (
  ConcatSource: IBundlerSources['ConcatSource'],
  id: string,
  modules: any,
  commonChunks: Array<{ name?: string | null }>,
  appConfig?: AppConfig
) {
  const source = new ConcatSource()
  if (process.env.TARO_ENV === 'tt' && appConfig) {
    source.add(`
if (typeof tt !== 'undefined') {
  tt.__$enableTTDom$__ = ${appConfig.enableTTDom};
}\n`)
  }
  commonChunks.forEach(chunkItem => {
    if (!chunkItem?.name) {
      return
    }
    source.add(`require(${JSON.stringify(promoteRelativePath(path.relative(id, chunkItem.name)))});\n`)
  })
  source.add('\n')
  source.add(modules)
  source.add(';')
  return source
}

export function getChunkEntryModuleFromCompilation (compilation: any, chunk: any) {
  const chunkGraph = compilation?.chunkGraph
  if (!chunkGraph?.getChunkEntryModulesIterable) {
    return undefined
  }
  const entryModules = Array.from(chunkGraph.getChunkEntryModulesIterable(chunk))
  if (entryModules.length) {
    return entryModules[0]
  }
}

export function errorHandling (errorLevel?: number, stats?: { hasErrors: () => boolean } | null) {
  if (errorLevel === 1 && stats?.hasErrors()) {
    process.exit(1)
  }
}

export interface IBaseLoadChunksPluginOptions {
  commonChunks: string[]
  isBuildPlugin: boolean
  framework: string
  addChunkPages?: AddPageChunks
  pages: Set<IComponent>
  needAddCommon?: string[]
  isIndependentPackages?: boolean
  appConfig?: AppConfig
}

export abstract class BaseLoadChunksPlugin {
  commonChunks: string[]
  isBuildPlugin: boolean
  framework: string
  addChunkPages?: AddPageChunks
  pages: Set<IComponent>
  needAddCommon: string[] = []
  isIndependentPackages = false
  appConfig?: AppConfig
  isCompDepsFound = false

  constructor (options: IBaseLoadChunksPluginOptions) {
    Object.assign(this, options)
    this.needAddCommon = options.needAddCommon || []
    this.isIndependentPackages = options.isIndependentPackages || false
  }

  private normalizeChunkRuntime (runtime: any) {
    // Rspack 2.3.4 exposes chunk.runtime as a plain JS Set (without webpack's SortableSet.sort)
    // and rejects Set arguments in moduleGraph.getUsedExports, requiring string | string[].
    return typeof runtime !== 'string' &&
      runtime instanceof Set &&
      typeof (runtime as any).sort !== 'function'
      ? Array.from(runtime)
      : runtime
  }

  protected collectComponents (
    compilation: any,
    chunk: any,
    componentConfig: IComponentConfig,
    comparator?: any
  ): boolean {
    const chunkGraph = compilation?.chunkGraph
    const moduleGraph = compilation?.moduleGraph
    if (!chunkGraph || typeof moduleGraph?.getUsedExports !== 'function') return false

    const modulesIterable: Iterable<any> | undefined =
      comparator && typeof chunkGraph.getOrderedChunkModulesIterable === 'function'
        ? chunkGraph.getOrderedChunkModulesIterable(chunk, comparator)
        : chunkGraph.getChunkModulesIterable?.(chunk)
    if (!modulesIterable) return false

    const runtime = this.normalizeChunkRuntime(chunk.runtime)

    const inspectModule = (mod: any): boolean => {
      if (mod?.rawRequest !== taroJsComponents) return false
      this.isCompDepsFound = true
      const includes = componentConfig.includes
      const moduleUsedExports = moduleGraph.getUsedExports(mod, runtime)
      if (moduleUsedExports === null || typeof moduleUsedExports === 'boolean') {
        componentConfig.includeAll = true
      } else {
        for (const item of moduleUsedExports) {
          const dashed = toDashed(item)
          if (!componentConfig.exclude?.has(dashed)) {
            includes.add(dashed)
          }
        }
      }
      return true
    }

    for (const module of modulesIterable) {
      if (inspectModule(module)) return true
      if (module?.modules && typeof module.modules[Symbol.iterator] === 'function') {
        for (const nested of module.modules) {
          if (inspectModule(nested)) return true
        }
      }
    }

    return false
  }

  protected collectComponentsFromCompilationModules (
    compilation: any,
    chunksArray: any[],
    componentConfig: IComponentConfig
  ): boolean {
    const moduleGraph = compilation?.moduleGraph
    const modules = compilation?.modules
    if (!modules || typeof moduleGraph?.getUsedExports !== 'function') return false

    const uniqueRuntimes: any[] = []
    const seenRuntimeKeys = new Set<string>()
    for (const chunk of chunksArray) {
      if (chunk?.runtime === undefined) continue
      const normalized = this.normalizeChunkRuntime(chunk.runtime)
      const key = typeof normalized === 'string'
        ? normalized
        : Array.isArray(normalized)
          ? [...normalized].sort().join('\0')
          : Array.from(normalized as Iterable<string>).sort().join('\0')
      if (!seenRuntimeKeys.has(key)) {
        seenRuntimeKeys.add(key)
        uniqueRuntimes.push(normalized)
      }
    }
    if (uniqueRuntimes.length === 0) {
      uniqueRuntimes.push(undefined)
    }

    const inspectModule = (mod: any): boolean => {
      if (mod?.rawRequest !== taroJsComponents) return false
      this.isCompDepsFound = true
      const includes = componentConfig.includes
      for (const runtime of uniqueRuntimes) {
        const moduleUsedExports = moduleGraph.getUsedExports(mod, runtime)
        if (moduleUsedExports === false) continue
        if (moduleUsedExports === null || moduleUsedExports === true) {
          componentConfig.includeAll = true
        } else {
          for (const item of moduleUsedExports) {
            const dashed = toDashed(item)
            if (!componentConfig.exclude?.has(dashed)) {
              includes.add(dashed)
            }
          }
        }
      }
      return true
    }

    for (const module of modules) {
      if (inspectModule(module)) return true
      if (module?.modules && typeof module.modules[Symbol.iterator] === 'function') {
        for (const nested of module.modules) {
          if (inspectModule(nested)) return true
        }
      }
    }

    return false
  }

  protected collectComponentsFromChunks (
    compilation: any,
    chunksArray: any[],
    commonChunks: any[],
    componentConfig: IComponentConfig,
    comparator?: any
  ) {
    this.isCompDepsFound = false
    for (const chunk of commonChunks) {
      this.collectComponents(compilation, chunk, componentConfig, comparator)
    }
    if (!this.isCompDepsFound) {
      chunksArray
        .filter(chunk => !chunk.name || !this.commonChunks.includes(chunk.name))
        .some(chunk => {
          this.collectComponents(compilation, chunk, componentConfig, comparator)
          return this.isCompDepsFound
        })
    }
    // Under Rspack 2.3.4 production `inlineExports`, pure-constant `@tarojs/components`
    // modules can be inlined and removed from all chunk module lists while remaining
    // present in `compilation.modules` with accurate `moduleGraph.getUsedExports`.
    if (!this.isCompDepsFound) {
      this.collectComponentsFromCompilationModules(compilation, chunksArray, componentConfig)
    }
  }

  protected getActiveCommonChunks (chunksArray: any[], compilation: any): Array<{ name: string }> {
    return this.commonChunks
      .filter(name => {
        const matched = chunksArray.find(c => c.name === name)
        return Boolean(compilation.assets?.[`${name}.js`] || (matched && chunkHasJs(matched, compilation)))
      })
      .reverse()
      .map(name => ({ name }))
  }

  protected collectAddChunkPagesDeps (
    chunksArray: any[],
    getChunkId: (chunk: any) => string = getChunkIdOrName,
    addChunkPagesList: Map<string, string[]> = new Map()
  ): Map<string, { name: string }[]> {
    const fileChunks = new Map<string, { name: string }[]>()
    if (typeof this.addChunkPages === 'function') {
      this.addChunkPages(addChunkPagesList, Array.from(this.pages).map(item => item.name))
      chunksArray.forEach(chunk => {
        const id = getChunkId(chunk)
        addChunkPagesList.forEach((deps, pageName) => {
          if (pageName === id) {
            const depChunks = deps.map(dep => ({ name: dep }))
            fileChunks.set(id, depChunks)
          }
        })
      })
    }
    return fileChunks
  }

  abstract apply (compiler: any): void
}

export function transformEntryChunkSource (opts: {
  chunkName: string
  miniType?: META_TYPE
  isNativePage?: boolean
  source: any
  commonChunks: Array<{ name?: string | null }>
  fileChunks: Map<string, { name: string }[]>
  isBuildPlugin: boolean
  needAddCommon: string[]
  isIndependentPackages: boolean
  appConfig?: AppConfig
  ConcatSource: IBundlerSources['ConcatSource']
}) {
  const { chunkName, miniType, isNativePage = false, commonChunks, fileChunks, isBuildPlugin, needAddCommon, isIndependentPackages, appConfig, ConcatSource } = opts
  let updated = opts.source

  if (miniType === META_TYPE.EXPORTS) {
    const wrapped = new ConcatSource()
    wrapped.add('module.exports=')
    wrapped.add(updated)
    updated = wrapped
  }

  if (isBuildPlugin) {
    return addRequireToSourceWith(ConcatSource, chunkName, updated, commonChunks)
  }

  if (needAddCommon.includes(chunkName)) {
    return addRequireToSourceWith(ConcatSource, chunkName, updated, commonChunks)
  }

  if (miniType === META_TYPE.ENTRY) {
    return addRequireToSourceWith(ConcatSource, chunkName, updated, commonChunks, appConfig)
  }

  if (
    isIndependentPackages &&
    (miniType === META_TYPE.PAGE || miniType === META_TYPE.COMPONENT || isNativePage)
  ) {
    return addRequireToSourceWith(ConcatSource, chunkName, updated, commonChunks)
  }

  if (fileChunks.size && (miniType === META_TYPE.PAGE || miniType === META_TYPE.COMPONENT)) {
    const extraDeps = fileChunks.get(chunkName)
    if (extraDeps) {
      return addRequireToSourceWith(ConcatSource, chunkName, updated, extraDeps)
    }
  }

  return updated
}
