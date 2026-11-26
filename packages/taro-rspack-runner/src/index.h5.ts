import { rspack } from '@rspack/core'
import { RspackDevServer } from '@rspack/dev-server'
import { runH5Build } from '@tarojs/runner-utils/bundler/runner'

import { H5Combination } from './rspack/h5'
import { type IH5BuildConfig, wrapAssetsForModifyHook } from './utils/rspack'

import type { Configuration, Stats } from '@rspack/core'
import type { Configuration as DevServerConfiguration } from '@rspack/dev-server'

export default async function build (appPath: string, rawConfig: IH5BuildConfig): Promise<Stats | void> {
  const combination = new H5Combination(appPath, rawConfig)
  await combination.make()

  const origModifyBuildAssets = combination.config.modifyBuildAssets
  const runConfig = typeof origModifyBuildAssets === 'function'
    ? {
      ...combination.config,
      modifyBuildAssets: (assets: any) => origModifyBuildAssets(wrapAssetsForModifyHook(assets))
    }
    : combination.config

  return runH5Build<Stats, Configuration, DevServerConfiguration>({
    appPath,
    config: runConfig,
    bundlerConfig: combination.chain.toConfig() as Configuration,
    isBuildNativeComp: combination.isBuildNativeComp,
    normalizeLegacyHttps: true,
    createCompiler: cfg => rspack(cfg),
    createDevServer: (devServerOpts, compiler) => new RspackDevServer(devServerOpts, compiler)
  })
}
