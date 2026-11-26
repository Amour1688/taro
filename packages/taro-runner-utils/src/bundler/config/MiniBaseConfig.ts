import { defaultMainFields, resolveSync } from '@tarojs/helper'

export function getMiniResolveConfig (
  appPath: string,
  regeneratorRuntimePath: string,
  fallbackResolve?: (id: string) => string
) {
  const mainFields = [...defaultMainFields]
  // Note: mini 端统一优先读取 main:mini 入口
  mainFields.unshift('main:mini')
  const resolveOptions = {
    basedir: appPath,
    mainFields,
  }
  const resolvePkg = (id: string) => resolveSync(id, resolveOptions) || (fallbackResolve ? fallbackResolve(id) : null)
  return {
    mainFields,
    alias: {
      // 小程序使用 regenerator-runtime@0.11
      'regenerator-runtime': regeneratorRuntimePath,
      // 开发组件库时 link 到本地调试，runtime 包需要指向本地 node_modules 顶层的 runtime，保证闭包值 Current 一致，shared 也一样
      '@tarojs/runtime': resolvePkg('@tarojs/runtime'),
      '@tarojs/shared': resolvePkg('@tarojs/shared'),
    },
    // [Webpack 4] config.node: { fs: false, path: false }
    // [Webpack 5] config.resolve.fallback
    fallback: {
      fs: false,
      path: false,
    },
  }
}

export function getMiniBaseConfigMerge (
  appPath: string,
  regeneratorRuntimePath: string,
  fallbackResolve?: (id: string) => string
) {
  return {
    resolve: getMiniResolveConfig(appPath, regeneratorRuntimePath, fallbackResolve),
    optimization: {
      sideEffects: true,
    },
    performance: {
      maxEntrypointSize: 2 * 1000 * 1000,
    },
  }
}
