import { collectModuleComponentMetaFromAst, createModuleComponentMeta } from '@tarojs/runner-utils/bundler/componentCollector'
import * as acorn from 'acorn'

import { componentConfig, componentNameSet, elementNameSet } from '../utils/context'

import type { LoaderContext } from '@rspack/core'
import type AcornWalk from 'acorn-walk'

const walk = require('acorn-walk') as typeof AcornWalk

export default function taroComponentCollectorLoader (this: LoaderContext<any>, source: string, map?: any) {
  const options = this.getOptions?.() || {}

  try {
    const ast = acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module'
    })

    const meta = collectModuleComponentMetaFromAst(ast, walk, {
      target: createModuleComponentMeta(),
      componentConfig,
      onParseCreateElement: options.onParseCreateElement
    })

    const currentModule = (this as any)._module
    if (currentModule) {
      Object.assign(currentModule, meta)
    }

    for (const name of meta.elementNameSet) {
      elementNameSet.add(name)
    }
    for (const name of meta.componentNameSet) {
      componentNameSet.add(name)
    }
  } catch {
    // Ignore AST parse failures on non-standard modules
  }

  this.callback(null, source, map)
}
