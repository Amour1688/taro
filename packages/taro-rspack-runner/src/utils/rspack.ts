import {
  chunkHasJs,
  errorHandling,
  getChunkIdOrName
} from '@tarojs/runner-utils/bundler/loadChunks'

import type { EntryObject } from '@rspack/core'
import type {
  AddPageChunks,
  CommonBuildConfig as BaseCommonBuildConfig,
  IChain,
  IComponent,
  IComponentObj,
  IFileType,
  IH5BuildConfig as BaseH5BuildConfig,
  IMiniBuildConfig as BaseMiniBuildConfig,
  IOption
} from '@tarojs/runner-utils/bundler/types'

export type { AddPageChunks, IChain, IComponent, IComponentObj, IFileType, IOption }

export type CommonBuildConfig = BaseCommonBuildConfig<EntryObject>
export type IMiniBuildConfig = BaseMiniBuildConfig<EntryObject>
export type IH5BuildConfig = BaseH5BuildConfig<EntryObject>

export { chunkHasJs, errorHandling, getChunkIdOrName }

export function wrapAssetsForModifyHook (assets: Record<string, any>) {
  if (!assets || typeof assets !== 'object') return assets
  return new Proxy(assets, {
    get (target, prop, receiver) {
      if (prop === Symbol.toPrimitive || prop === 'toString') {
        return () => '[object CompilationAssets]'
      }
      if (prop === 'valueOf') {
        return () => target
      }
      if (prop === 'hasOwnProperty') {
        return (key: PropertyKey) => typeof key === 'string' && Object.keys(target).includes(key)
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}
